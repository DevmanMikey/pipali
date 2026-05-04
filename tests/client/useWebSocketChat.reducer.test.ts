import { test, expect } from 'bun:test';
import { __test__ } from '../../src/client/hooks/useWebSocketChat';
import type { ConversationState, Message, ChatState } from '../../src/client/types';
import { generateDeterministicId } from '../../src/client/utils/formatting';

function makeState(params: {
    conversationId: string;
    messages: Message[];
    conversationState: ConversationState;
}) {
    return {
        ...__test__.initialState,
        conversationId: params.conversationId,
        messages: params.messages,
        conversationStates: new Map([[params.conversationId, params.conversationState]]),
        pendingConfirmations: new Map(__test__.initialState.pendingConfirmations),
    };
}

test('RUN_COMPLETE preserves assistant stableId but updates persisted id', () => {
    const conversationId = 'c1';
    const runId = 'run-1';

    const assistant: Message = {
        id: runId,
        stableId: runId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        thoughts: [],
    };

    const state = makeState({
        conversationId,
        messages: [assistant],
        conversationState: {
            isProcessing: true,
            isStopped: false,
            isCompleted: false,
            messages: [assistant],
        },
    });

    const next = __test__.chatReducer(state, {
        type: 'RUN_COMPLETE',
        conversationId,
        runId,
        response: 'done',
        stepId: 42,
    });

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]?.id).toBe('42');
    expect(next.messages[0]?.stableId).toBe(runId);
    expect(next.conversationStates.get(conversationId)?.messages[0]?.stableId).toBe(runId);
});

test('RUN_COMPLETE appends assistant with stepId stableId when missing', () => {
    const conversationId = 'c1';
    const runId = 'run-1';

    const state = makeState({
        conversationId,
        messages: [],
        conversationState: {
            isProcessing: true,
            isStopped: false,
            isCompleted: false,
            messages: [],
        },
    });

    const next = __test__.chatReducer(state, {
        type: 'RUN_COMPLETE',
        conversationId,
        runId,
        response: 'done',
        stepId: 7,
    });

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]?.id).toBe('7');
    expect(next.messages[0]?.stableId).toBe('7');
});

test('SET_CONVERSATION_ID switches visible messages to target conversation', () => {
    const state = {
        ...__test__.initialState,
        conversationId: 'a',
        messages: [{ id: 'm1', stableId: 'm1', role: 'assistant', content: 'from a' }],
        conversationStates: new Map([
            ['a', { isProcessing: false, isStopped: false, isCompleted: false, messages: [{ id: 'm1', stableId: 'm1', role: 'assistant', content: 'from a' }] }],
            ['b', { isProcessing: false, isStopped: false, isCompleted: false, messages: [{ id: 'm2', stableId: 'm2', role: 'assistant', content: 'from b' }] }],
        ]),
        pendingConfirmations: new Map(__test__.initialState.pendingConfirmations),
    };

    const next = __test__.chatReducer(state, { type: 'SET_CONVERSATION_ID', id: 'b' });
    expect(next.conversationId).toBe('b');
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]?.content).toBe('from b');
});

test('SET_CONVERSATION_ID clears visible messages when target has no cached state', () => {
    const state = {
        ...__test__.initialState,
        conversationId: 'a',
        messages: [{ id: 'm1', stableId: 'm1', role: 'assistant', content: 'from a' }],
        conversationStates: new Map([
            ['a', { isProcessing: true, isStopped: false, isCompleted: false, messages: [{ id: 'm1', stableId: 'm1', role: 'assistant', content: 'from a' }] }],
        ]),
        pendingConfirmations: new Map(__test__.initialState.pendingConfirmations),
        runStatus: 'running' as const,
        currentRunId: 'run-a',
    };

    const next = __test__.chatReducer(state, { type: 'SET_CONVERSATION_ID', id: 'b' });
    expect(next.conversationId).toBe('b');
    expect(next.messages).toHaveLength(0);
    expect(next.runStatus).toBe('idle');
});

test('STEP_START and COMPACTION use deterministic IDs to dedupe events replayed on reconnection', () => {
    const conversationId = 'c1';
    const runId = 'run-1';

    // 1. Setup the initial state as if the page just hydrated from LocalStorage
    // It already has a "reasoning" thought and a "compaction" thought.
    const reasoningText = "Step 1: I need to search the codebase";
    const compactionText = "**Compact Context.**\nCompacted 50 messages.";

    // We intentionally build the initial state using the deterministic ID to prove
    // that the test fails if the reducer uses `generateUUID()` (since they won't match),
    // and passes if the reducer uses `generateDeterministicId()`.
    const expectedReasoningId = generateDeterministicId('thought', reasoningText);
    const expectedCompactionId = generateDeterministicId('compaction', compactionText);

    const hydratedAssistant: Message = {
        id: runId,
        stableId: runId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        thoughts: [
            {
                id: expectedReasoningId,
                type: 'thought',
                content: reasoningText,
                isInternalThought: true,
            },
            {
                id: expectedCompactionId,
                type: 'thought',
                content: compactionText,
                isInternalThought: true,
            }
        ],
    };

    const state: ChatState = {
        ...__test__.initialState,
        conversationId,
        messages: [hydratedAssistant],
        conversationStates: new Map([[conversationId, {
            isProcessing: true,
            isStopped: false,
            isCompleted: false,
            messages: [hydratedAssistant],
        }]]),
        pendingConfirmations: new Map(),
    };

    // 2. Simulate the WebSocket reconnecting and replaying the exact same STEP_START event
    const afterStepStart = __test__.chatReducer(state, {
        type: 'STEP_START',
        conversationId,
        runId,
        thought: reasoningText,
        message: '',
        toolCalls: [],
    });

    // 3. Simulate the WebSocket replaying the exact same COMPACTION event
    const afterCompaction = __test__.chatReducer(afterStepStart, {
        type: 'COMPACTION',
        conversationId,
        runId,
        summary: "Compacted 50 messages.",
    });

    // 4. Verification
    const finalAssistant = afterCompaction.messages[0];

    // If the reducer uses generateUUID(), it will blindly append new thoughts with random IDs, resulting in 4 thoughts.
    // If it uses deterministic IDs, it will see the exact same ID (expectedReasoningId/expectedCompactionId)
    // already exists in the Set and skip appending them, keeping the length at 2.
    expect(finalAssistant?.thoughts).toHaveLength(2);
    expect(finalAssistant?.thoughts?.[0]?.content).toBe(reasoningText);
    expect(finalAssistant?.thoughts?.[1]?.content).toBe(compactionText);
});

test('OPTIMISTIC_RUN_STARTED during an in-flight run marks the user message queued and skips the assistant placeholder', () => {
    const conversationId = 'c1';
    const runningRunId = 'run-1';
    const queuedClientMessageId = 'cm-2';
    const queuedRunId = 'run-2';

    const runningAssistant: Message = {
        id: runningRunId,
        stableId: runningRunId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        thoughts: [{ id: 't1', type: 'thought', content: 'thinking...' }],
    };

    const queuedUser: Message = {
        id: queuedClientMessageId,
        stableId: queuedClientMessageId,
        role: 'user',
        content: 'second question',
    };

    const state: ChatState = {
        ...__test__.initialState,
        conversationId,
        messages: [runningAssistant, queuedUser],
        conversationStates: new Map([[conversationId, {
            isProcessing: true,
            isStopped: false,
            isCompleted: false,
            messages: [runningAssistant, queuedUser],
        }]]),
        pendingConfirmations: new Map(),
        runStatus: 'running',
        currentRunId: runningRunId,
    };

    const next = __test__.chatReducer(state, {
        type: 'OPTIMISTIC_RUN_STARTED',
        conversationId,
        runId: queuedRunId,
        clientMessageId: queuedClientMessageId,
    });

    // No second assistant placeholder for queuedRunId — only the original streaming assistant remains.
    const assistants = next.messages.filter(m => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.stableId).toBe(runningRunId);

    // The queued user message is flagged.
    const user = next.messages.find(m => m.stableId === queuedClientMessageId);
    expect(user?.isQueued).toBe(true);

    // currentRunId stays on the in-flight run (so stop targets the right run server-side).
    expect(next.currentRunId).toBe(runningRunId);
    expect(next.runStatus).toBe('running');
});

test('RUN_STARTED clears the isQueued flag on the matched user message and inserts the assistant placeholder', () => {
    const conversationId = 'c1';
    const queuedClientMessageId = 'cm-2';
    const queuedRunId = 'run-2';

    const queuedUser: Message = {
        id: queuedClientMessageId,
        stableId: queuedClientMessageId,
        role: 'user',
        content: 'second question',
        isQueued: true,
    };

    const state: ChatState = {
        ...__test__.initialState,
        conversationId,
        messages: [queuedUser],
        conversationStates: new Map([[conversationId, {
            isProcessing: false,
            isStopped: false,
            isCompleted: false,
            messages: [queuedUser],
        }]]),
        pendingConfirmations: new Map(),
    };

    const next = __test__.chatReducer(state, {
        type: 'RUN_STARTED',
        conversationId,
        runId: queuedRunId,
        clientMessageId: queuedClientMessageId,
    });

    const user = next.messages.find(m => m.stableId === queuedClientMessageId);
    expect(user?.isQueued).toBe(false);

    // Assistant placeholder for the queued run is inserted right after the user message.
    const userIdx = next.messages.findIndex(m => m.stableId === queuedClientMessageId);
    expect(next.messages[userIdx + 1]?.role).toBe('assistant');
    expect(next.messages[userIdx + 1]?.stableId).toBe(queuedRunId);
});

// Cover all reasons: error/disconnect leave the queue unrecoverable, same UX cleanup as user_stop.
for (const reason of ['user_stop', 'error', 'disconnect'] as const) {
    test(`RUN_STOPPED (${reason}) clears isQueued flags on user messages`, () => {
        const conversationId = 'c1';
        const runningRunId = 'run-1';

        const runningAssistant: Message = {
            id: runningRunId,
            stableId: runningRunId,
            role: 'assistant',
            content: '',
            isStreaming: true,
            thoughts: [{ id: 't1', type: 'thought', content: 'thinking...' }],
        };

        const queuedUser: Message = {
            id: 'cm-2',
            stableId: 'cm-2',
            role: 'user',
            content: 'queued message',
            isQueued: true,
        };

        const state: ChatState = {
            ...__test__.initialState,
            conversationId,
            messages: [runningAssistant, queuedUser],
            conversationStates: new Map([[conversationId, {
                isProcessing: true,
                isStopped: false,
                isCompleted: false,
                messages: [runningAssistant, queuedUser],
            }]]),
            pendingConfirmations: new Map(),
            runStatus: 'running',
            currentRunId: runningRunId,
        };

        const next = __test__.chatReducer(state, {
            type: 'RUN_STOPPED',
            conversationId,
            runId: runningRunId,
            reason,
        });

        const user = next.messages.find(m => m.stableId === 'cm-2');
        expect(user?.isQueued).toBe(false);
    });
}
