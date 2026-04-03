import {
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  collectToolUpdates,
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  extractRawFilePaths,
  getMessageText,
  getToolCallFilePath,
  hasErrorRecoveryTimer,
  hasNonToolAssistantContent,
  isToolOnlyMessage,
  isToolResultRole,
  makeAttachedFile,
  setErrorRecoveryTimer,
  upsertToolStatuses,
} from './helpers';
import type { AttachedFileMeta, RawMessage } from './types';
import type { ChatGet, ChatSet } from './store-api';

function toMs(timestamp: number): number {
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function isEquivalentAssistantMessage(a: RawMessage, b: RawMessage): boolean {
  if (a.role !== 'assistant' || b.role !== 'assistant') {
    return false;
  }

  const aText = getMessageText(a.content).trim();
  const bText = getMessageText(b.content).trim();
  if (!aText || !bText || aText !== bText) {
    return false;
  }

  if (typeof a.timestamp === 'number' && typeof b.timestamp === 'number') {
    return Math.abs(toMs(a.timestamp) - toMs(b.timestamp)) < 5_000;
  }

  return true;
}

function isAssistantLikeMessage(message: RawMessage | null | undefined): message is RawMessage {
  if (!message) {
    return false;
  }
  return message.role === 'assistant' || message.role === undefined;
}

function shouldPreserveStreamingMessage(current: unknown, incoming: unknown): boolean {
  if (!current || !incoming || typeof incoming !== 'object') {
    return false;
  }

  const incomingMessage = incoming as RawMessage;
  if (isToolResultRole(incomingMessage.role)) {
    return true;
  }

  return incomingMessage.content === undefined;
}

function buildStableSnapshotId(message: RawMessage, runId: string): string {
  if (message.id) {
    return message.id;
  }

  const text = getMessageText(message.content).trim();
  if (text) {
    return `run-${runId || 'run'}-assistant-${text}`;
  }

  if (typeof message.toolCallId === 'string' && message.toolCallId) {
    return `run-${runId || 'run'}-toolcall-${message.toolCallId}`;
  }

  if (typeof message.timestamp === 'number') {
    return `run-${runId || 'run'}-ts-${toMs(message.timestamp)}`;
  }

  return `run-${runId || 'run'}-assistant-empty`;
}

function snapshotAssistantMessage(
  messages: RawMessage[],
  message: RawMessage | null | undefined,
  runId: string,
): RawMessage[] {
  if (!isAssistantLikeMessage(message)) {
    return messages;
  }

  const snapshot: RawMessage = {
    ...message,
    role: 'assistant',
    id: buildStableSnapshotId(message, runId),
  };

  const alreadyExists = messages.some((existing) => {
    if (existing.id === snapshot.id) {
      return true;
    }

    return isEquivalentAssistantMessage(existing as RawMessage, snapshot);
  });

  return alreadyExists ? messages : [...messages, snapshot];
}

function resolveStreamingMessage(current: unknown, incoming: unknown): unknown {
  return shouldPreserveStreamingMessage(current, incoming) ? current : (incoming ?? current);
}

export function handleRuntimeEventState(
  set: ChatSet,
  get: ChatGet,
  event: Record<string, unknown>,
  resolvedState: string,
  runId: string,
): void {
      switch (resolvedState) {
        case 'started': {
          // Run just started (e.g. from console); show loading immediately.
          const { sending: currentSending } = get();
          if (!currentSending && runId) {
            set({ sending: true, activeRunId: runId, error: null });
          }
          break;
        }
        case 'delta': {
          // If we're receiving new deltas, the Gateway has recovered from any
          // prior error — cancel the error finalization timer and clear the
          // stale error banner so the user sees the live stream again.
          if (hasErrorRecoveryTimer()) {
            clearErrorRecoveryTimer();
            set({ error: null });
          }
          const updates = collectToolUpdates(event.message, resolvedState);
          set((s) => ({
            streamingMessage: resolveStreamingMessage(s.streamingMessage, event.message),
            streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
          }));
          break;
        }
        case 'final': {
          clearErrorRecoveryTimer();
          if (get().error) set({ error: null });
          // Message complete - add to history and clear streaming
          const finalMsg = event.message as RawMessage | undefined;
          if (finalMsg) {
            const updates = collectToolUpdates(finalMsg, resolvedState);
            if (isToolResultRole(finalMsg.role)) {
              // Resolve file path from the streaming assistant message's matching tool call
              const currentStreamForPath = get().streamingMessage as RawMessage | null;
              const matchedPath = (currentStreamForPath && finalMsg.toolCallId)
                ? getToolCallFilePath(currentStreamForPath, finalMsg.toolCallId)
                : undefined;

              // Mirror enrichWithToolResultFiles: collect images + file refs for next assistant msg
              const toolFiles: AttachedFileMeta[] = [
                ...extractImagesAsAttachedFiles(finalMsg.content),
              ];
              if (matchedPath) {
                for (const f of toolFiles) {
                  if (!f.filePath) {
                    f.filePath = matchedPath;
                    f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
                  }
                }
              }
              const text = getMessageText(finalMsg.content);
              if (text) {
                const mediaRefs = extractMediaRefs(text);
                const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
                for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref));
                for (const ref of extractRawFilePaths(text)) {
                  if (!mediaRefPaths.has(ref.filePath)) toolFiles.push(makeAttachedFile(ref));
                }
              }
              set((s) => ({
                messages: snapshotAssistantMessage(s.messages as RawMessage[], s.streamingMessage as RawMessage | null, runId),
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                pendingToolImages: toolFiles.length > 0
                  ? [...s.pendingToolImages, ...toolFiles]
                  : s.pendingToolImages,
                streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
              }));
              break;
            }
            const toolOnly = isToolOnlyMessage(finalMsg);
            const hasOutput = hasNonToolAssistantContent(finalMsg);
            const msgId = finalMsg.id || buildStableSnapshotId(finalMsg, runId);
            set((s) => {
              const nextTools = updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
              const streamingTools = hasOutput ? [] : nextTools;

              // Attach any images collected from preceding tool results
              const pendingImgs = s.pendingToolImages;
              const msgWithImages: RawMessage = pendingImgs.length > 0
                ? {
                  ...finalMsg,
                  role: (finalMsg.role || 'assistant') as RawMessage['role'],
                  id: msgId,
                  _attachedFiles: [...(finalMsg._attachedFiles || []), ...pendingImgs],
                }
                : { ...finalMsg, role: (finalMsg.role || 'assistant') as RawMessage['role'], id: msgId };
              const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[] };

              // Check if message already exists (prevent duplicates)
              const alreadyExists = (s.messages as RawMessage[]).some((message) => {
                if (message.id === msgId) {
                  return true;
                }

                return isEquivalentAssistantMessage(message as RawMessage, msgWithImages);
              });
              if (alreadyExists) {
                return toolOnly ? {
                  streamingText: '',
                  streamingMessage: null,
                  pendingFinal: true,
                  streamingTools,
                  ...clearPendingImages,
                } : {
                  streamingText: '',
                  streamingMessage: null,
                  sending: hasOutput ? false : s.sending,
                  activeRunId: hasOutput ? null : s.activeRunId,
                  pendingFinal: hasOutput ? false : true,
                  streamingTools,
                  ...clearPendingImages,
                };
              }
              return toolOnly ? {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                streamingTools,
                ...clearPendingImages,
              } : {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
                streamingTools,
                ...clearPendingImages,
              };
            });
            // After the final response, quietly reload history to surface all intermediate
            // tool-use turns (thinking + tool blocks) from the Gateway's authoritative record.
            if (hasOutput && !toolOnly) {
              clearHistoryPoll();
              void get().loadHistory(true);
            }
          } else {
            // No message in final event - reload history to get complete data
            set({ streamingText: '', streamingMessage: null, pendingFinal: true });
            get().loadHistory();
          }
          break;
        }
        case 'error': {
          const errorMsg = String(event.errorMessage || 'An error occurred');
          const wasSending = get().sending;

          // Snapshot the current streaming message into messages[] so partial
          // content ("Let me get that written down...") is preserved in the UI
          // rather than being silently discarded.
          const currentStream = get().streamingMessage as RawMessage | null;
          if (isAssistantLikeMessage(currentStream)) {
            set((s) => ({
              messages: snapshotAssistantMessage(s.messages as RawMessage[], currentStream, runId),
            }));
          }

          set({
            error: errorMsg,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingFinal: false,
            pendingToolImages: [],
          });

          // Don't immediately give up: the Gateway often retries internally
          // after transient API failures (e.g. "terminated"). Keep `sending`
          // true for a grace period so that recovery events are processed and
          // the agent-phase-completion handler can still trigger loadHistory.
          if (wasSending) {
            clearErrorRecoveryTimer();
            const ERROR_RECOVERY_GRACE_MS = 15_000;
            setErrorRecoveryTimer(setTimeout(() => {
              setErrorRecoveryTimer(null);
              const state = get();
              if (state.sending && !state.streamingMessage) {
                clearHistoryPoll();
                // Grace period expired with no recovery — finalize the error
                set({
                  sending: false,
                  activeRunId: null,
                  lastUserMessageAt: null,
                });
                // One final history reload in case the Gateway completed in the
                // background and we just missed the event.
                state.loadHistory(true);
              }
            }, ERROR_RECOVERY_GRACE_MS));
          } else {
            clearHistoryPoll();
            set({ sending: false, activeRunId: null, lastUserMessageAt: null });
          }
          break;
        }
        case 'aborted': {
          clearHistoryPoll();
          clearErrorRecoveryTimer();
          set({
            sending: false,
            activeRunId: null,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
          });
          break;
        }
        default: {
          // Unknown or empty state — if we're currently sending and receive an event
          // with a message, attempt to process it as streaming data. This handles
          // edge cases where the Gateway sends events without a state field.
          const { sending } = get();
          if (sending && event.message && typeof event.message === 'object') {
            console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
            const updates = collectToolUpdates(event.message, 'delta');
            set((s) => ({
              streamingMessage: resolveStreamingMessage(s.streamingMessage, event.message),
              streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
            }));
          }
          break;
        }
      }
}
