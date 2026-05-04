import { describe, test, expect, beforeEach } from 'bun:test';
import {
    ConversationEventBus,
    getOrCreateBus,
    getBus,
    removeBus,
    clearAllBuses,
    createRunHandle,
} from '../../../src/server/events/conversation-event-bus';
import type { ConversationEvent } from '../../../src/server/events/conversation-event-bus';

beforeEach(() => {
    clearAllBuses();
});

describe('ConversationEventBus', () => {
    test('subscribe receives published events', () => {
        const bus = new ConversationEventBus('conv-1');
        const received: ConversationEvent[] = [];
        bus.subscribe(event => received.push(event));

        const event: ConversationEvent = {
            type: 'run_started',
            conversationId: 'conv-1',
            runId: 'run-1',
            clientMessageId: 'msg-1',
        };
        bus.publish(event);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(event);
    });

    test('unsubscribe stops receiving events', () => {
        const bus = new ConversationEventBus('conv-1');
        const received: ConversationEvent[] = [];
        const unsub = bus.subscribe(event => received.push(event));

        bus.publish({ type: 'run_started', conversationId: 'conv-1', runId: 'r1', clientMessageId: 'm1' });
        unsub();
        bus.publish({ type: 'run_complete', conversationId: 'conv-1', runId: 'r1', data: { response: 'ok', stepId: 1 } });

        expect(received).toHaveLength(1);
    });

    test('multiple subscribers all receive events', () => {
        const bus = new ConversationEventBus('conv-1');
        const received1: ConversationEvent[] = [];
        const received2: ConversationEvent[] = [];
        bus.subscribe(e => received1.push(e));
        bus.subscribe(e => received2.push(e));

        bus.publish({ type: 'run_started', conversationId: 'conv-1', runId: 'r1', clientMessageId: 'm1' });

        expect(received1).toHaveLength(1);
        expect(received2).toHaveLength(1);
    });

    test('hasSubscribers reflects current state', () => {
        const bus = new ConversationEventBus('conv-1');
        expect(bus.hasSubscribers()).toBe(false);

        const unsub = bus.subscribe(() => {});
        expect(bus.hasSubscribers()).toBe(true);

        unsub();
        expect(bus.hasSubscribers()).toBe(false);
    });

    test('replay buffer returns recent events', () => {
        const bus = new ConversationEventBus('conv-1');
        // Keep bus alive by setting an active run
        bus.activeRun = createRunHandle('r1', 'm1', 'conv-1');

        bus.publish({ type: 'run_started', conversationId: 'conv-1', runId: 'r1', clientMessageId: 'm1' });
        bus.publish({ type: 'step_start', conversationId: 'conv-1', runId: 'r1', data: { toolCalls: [] } });

        const replay = bus.getReplayEvents();
        expect(replay).toHaveLength(2);
        expect(replay[0]?.type).toBe('run_started');
        expect(replay[1]?.type).toBe('step_start');
    });

    test('text deltas are delivered live but not replayed', () => {
        const bus = new ConversationEventBus('conv-1');
        bus.activeRun = createRunHandle('r1', 'm1', 'conv-1');
        const received: ConversationEvent[] = [];
        bus.subscribe(event => received.push(event));

        bus.publish({ type: 'run_started', conversationId: 'conv-1', runId: 'r1', clientMessageId: 'm1' });
        bus.publish({ type: 'text_delta', conversationId: 'conv-1', runId: 'r1', data: { delta: 'Hello' } });
        bus.publish({ type: 'step_start', conversationId: 'conv-1', runId: 'r1', data: { toolCalls: [] } });

        expect(received.map(e => e.type)).toEqual(['run_started', 'text_delta', 'step_start']);
        expect(bus.getReplayEvents().map(e => e.type)).toEqual(['run_started', 'step_start']);
    });

    test('replay buffer resets on run_started', () => {
        const bus = new ConversationEventBus('conv-1');
        bus.activeRun = createRunHandle('r1', 'm1', 'conv-1');

        bus.publish({ type: 'step_start', conversationId: 'conv-1', runId: 'r0', data: { toolCalls: [] } });
        bus.publish({ type: 'run_started', conversationId: 'conv-1', runId: 'r1', clientMessageId: 'm1' });
        bus.publish({ type: 'step_start', conversationId: 'conv-1', runId: 'r1', data: { toolCalls: [] } });

        const replay = bus.getReplayEvents();
        expect(replay).toHaveLength(2); // run_started + step_start
        expect(replay[0]?.type).toBe('run_started');
    });

    test('subscribeWithReplay returns snapshot and streams new events', () => {
        const bus = new ConversationEventBus('conv-1');
        bus.activeRun = createRunHandle('r1', 'm1', 'conv-1');

        bus.publish({ type: 'run_started', conversationId: 'conv-1', runId: 'r1', clientMessageId: 'm1' });
        bus.publish({ type: 'step_start', conversationId: 'conv-1', runId: 'r1', data: { toolCalls: [] } });

        const received: ConversationEvent[] = [];
        const { replay, unsubscribe } = bus.subscribeWithReplay(e => received.push(e));

        expect(replay.map(e => e.type)).toEqual(['run_started', 'step_start']);

        bus.publish({ type: 'run_complete', conversationId: 'conv-1', runId: 'r1', data: { response: 'ok', stepId: 1 } });
        expect(received.map(e => e.type)).toEqual(['run_complete']);

        unsubscribe();
    });

    test('subscriber error does not affect other subscribers', () => {
        const bus = new ConversationEventBus('conv-1');
        bus.activeRun = createRunHandle('r1', 'm1', 'conv-1');
        const received: ConversationEvent[] = [];

        bus.subscribe(() => { throw new Error('boom'); });
        bus.subscribe(e => received.push(e));

        bus.publish({ type: 'run_started', conversationId: 'conv-1', runId: 'r1', clientMessageId: 'm1' });

        expect(received).toHaveLength(1);
    });
});

describe('Global registry', () => {
    test('getOrCreateBus creates and retrieves', () => {
        const bus1 = getOrCreateBus('conv-1');
        const bus2 = getOrCreateBus('conv-1');
        expect(bus1).toBe(bus2);
    });

    test('getBus returns undefined for missing', () => {
        expect(getBus('nonexistent')).toBeUndefined();
    });

    test('removeBus cleans up', () => {
        getOrCreateBus('conv-1');
        removeBus('conv-1');
        expect(getBus('conv-1')).toBeUndefined();
    });

    test('bus auto-cleans when no run and no subscribers', () => {
        const bus = getOrCreateBus('conv-1');
        bus.activeRun = createRunHandle('r1', 'm1', 'conv-1');

        const unsub = bus.subscribe(() => {});

        // Has run + subscriber — should not clean up
        unsub();
        expect(getBus('conv-1')).toBeDefined(); // still has activeRun

        // Run finishes
        bus.onRunFinished();
        expect(getBus('conv-1')).toBeUndefined(); // cleaned up
    });
});

describe('RunHandle', () => {
    test('createRunHandle initializes correctly', () => {
        const handle = createRunHandle('r1', 'm1', 'conv-1');
        expect(handle.runId).toBe('r1');
        expect(handle.clientMessageId).toBe('m1');
        expect(handle.conversationId).toBe('conv-1');
        expect(handle.stopMode).toBe('none');
        expect(handle.queuedMessages).toEqual([]);
        expect(handle.pendingConfirmations.size).toBe(0);
        expect(handle.abortController.signal.aborted).toBe(false);
    });
});
