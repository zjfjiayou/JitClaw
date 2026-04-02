import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';
import { TooltipProvider } from '@/components/ui/tooltip';

const refreshMock = vi.fn();
const toggleThinkingMock = vi.fn();

const { chatState, agentsState } = vi.hoisted(() => ({
  chatState: {
    loading: false,
    showThinking: false,
    currentAgentId: 'main',
  },
  agentsState: {
    agents: [
      {
        id: 'main',
        name: 'Main Agent',
        modelRef: 'custom-newapi/gpt-4.1-mini',
      },
    ] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState & {
    refresh: typeof refreshMock;
    toggleThinking: typeof toggleThinkingMock;
  }) => unknown) => selector({
    ...chatState,
    refresh: refreshMock,
    toggleThinking: toggleThinkingMock,
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'toolbar.currentAgent') {
        return `Current agent: ${options?.agent ?? ''}`;
      }
      return key;
    },
  }),
}));

describe('ChatToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the current agent and wires toolbar actions', () => {
    render(
      <TooltipProvider>
        <ChatToolbar />
      </TooltipProvider>,
    );

    const [refreshButton, toggleThinkingButton] = screen.getAllByRole('button');

    expect(screen.getByText('Current agent: Main Agent')).toBeInTheDocument();

    fireEvent.click(refreshButton);
    fireEvent.click(toggleThinkingButton);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toggleThinkingMock).toHaveBeenCalledTimes(1);
  });
});
