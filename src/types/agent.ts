export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}

export type AgentPromptFileKey = 'agents' | 'soul';

export interface AgentPromptFileSummary {
  fileKey: AgentPromptFileKey;
  fileName: string;
  exists: boolean;
  editable: boolean;
}

export interface AgentPromptFilesResponse {
  agentId: string;
  files: AgentPromptFileSummary[];
}

export interface AgentPromptFileResponse {
  agentId: string;
  fileKey: AgentPromptFileKey;
  fileName: string;
  exists: boolean;
  content: string;
  updatedAt: string | null;
}
