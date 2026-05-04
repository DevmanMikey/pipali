/**
 * Conversation Event Bus
 *
 * In-memory pub/sub keyed by conversationId. Runs publish events to the bus;
 * WebSocket connections subscribe. Runs complete independently of any observer.
 */

import type { ServerMessage, QueuedMessage, PendingConfirmation, StopReason } from '../routes/ws/message-types';
import type { ConfirmationPreferences } from '../processor/confirmation';
import type { User } from '../db/schema';
import { createChildLogger } from '../logger';

const log = createChildLogger({ component: 'event-bus' });

// Re-export ServerMessage as the event type
export type ConversationEvent = ServerMessage;

export interface RunHandle {
    runId: string;
    clientMessageId: string;
    conversationId: string;
    abortController: AbortController;
    stopMode: 'none' | 'soft' | 'hard';
    stopReason?: StopReason;
    queuedMessages: QueuedMessage[];
    pendingConfirmations: Map<string, PendingConfirmation>;
}

export function createRunHandle(runId: string, clientMessageId: string, conversationId: string): RunHandle {
    return {
        runId,
        clientMessageId,
        conversationId,
        abortController: new AbortController(),
        stopMode: 'none',
        stopReason: undefined,
        queuedMessages: [],
        pendingConfirmations: new Map(),
    };
}

type Subscriber = (event: ConversationEvent) => void;

// Replay needs to comfortably cover a full run's worth of events.
// Each tool step typically produces 2 events (step_start + step_end), plus lifecycle events.
const MAX_REPLAY_EVENTS = 250;

export class ConversationEventBus {
    readonly conversationId: string;
    private subscribers = new Set<Subscriber>();
    private recentEvents: ConversationEvent[] = [];
    activeRun: RunHandle | null = null;

    /** Context carried across queued runs within the same bus */
    user: typeof User.$inferSelect | null = null;
    confirmationPreferences: ConfirmationPreferences | null = null;
    chatModelId?: number;

    constructor(conversationId: string) {
        this.conversationId = conversationId;
    }

    subscribe(fn: Subscriber): () => void {
        this.subscribers.add(fn);
        return () => {
            this.subscribers.delete(fn);
            this.maybeCleanup();
        };
    }

    /**
     * Subscribe and return a replay snapshot captured in the same synchronous tick.
     * Useful for observe flows that want to send replay first, then live events.
     */
    subscribeWithReplay(fn: Subscriber): { unsubscribe: () => void; replay: ConversationEvent[] } {
        const replay = this.getReplayEvents();
        const unsubscribe = this.subscribe(fn);
        return { unsubscribe, replay };
    }

    publish(event: ConversationEvent): void {
        // Reset replay buffer on run_started
        if (event.type === 'run_started') {
            this.recentEvents = [];
        }

        this.recentEvents.push(event);
        if (this.recentEvents.length > MAX_REPLAY_EVENTS) {
            this.recentEvents.shift();
        }

        for (const fn of this.subscribers) {
            try {
                fn(event);
            } catch (err) {
                log.error({ err, conversationId: this.conversationId }, 'Subscriber error');
            }
        }
    }

    hasSubscribers(): boolean {
        return this.subscribers.size > 0;
    }

    getReplayEvents(): ConversationEvent[] {
        // Replay exists to let late observers catch up on an in-flight run.
        // If there's no active run, clients should rely on persisted history instead.
        // Replaying old run events after completion can cause duplicate UI updates.
        if (!this.activeRun) return [];

        // Don't replay confirmations that are no longer actionable.
        // If a confirmation was already responded to, it will have been removed
        // from the active run's pendingConfirmations map. Replaying it would
        // cause the UI to re-show an already-acknowledged dialog/toast after reload.
        const pending = this.activeRun.pendingConfirmations;

        return this.recentEvents.filter(e => {
            // Text deltas are append-only on the client. Replaying them after
            // localStorage hydration can duplicate partially streamed content.
            if (e.type === 'text_delta') return false;
            if (e.type !== 'confirmation_request') return true;
            const requestId = (e as any)?.data?.requestId;
            return typeof requestId === 'string' && pending.has(requestId);
        });
    }

    private maybeCleanup(): void {
        if (!this.activeRun && this.subscribers.size === 0) {
            removeBus(this.conversationId);
        }
    }

    /** Called when a run finishes to potentially clean up the bus */
    onRunFinished(): void {
        this.activeRun = null;
        this.maybeCleanup();
    }
}

// Global registry
const buses = new Map<string, ConversationEventBus>();

export function getOrCreateBus(conversationId: string): ConversationEventBus {
    let bus = buses.get(conversationId);
    if (!bus) {
        bus = new ConversationEventBus(conversationId);
        buses.set(conversationId, bus);
    }
    return bus;
}

export function getBus(conversationId: string): ConversationEventBus | undefined {
    return buses.get(conversationId);
}

export function removeBus(conversationId: string): void {
    buses.delete(conversationId);
}

/** For testing: clear all buses */
export function clearAllBuses(): void {
    buses.clear();
}
