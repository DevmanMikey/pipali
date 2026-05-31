import { useCallback, useEffect, useRef } from 'react';

type EnqueueDelta = (conversationId: string, runId: string, delta: string) => void;
type FlushRun = (conversationId: string, runId: string) => void;
type ClearRun = (conversationId: string, runId?: string) => void;

type DispatchTextDelta = (args: {
    conversationId: string;
    runId: string;
    delta: string;
}) => void;

type RunBuffer = {
    conversationId: string;
    runId: string;
    buffer: string;
    timer: ReturnType<typeof setTimeout> | null;
};

const CHARS_PER_TICK = 3;
const BASE_DELAY_MS = 20;
const COMMA_PAUSE_MS = 80;
const SENTENCE_PAUSE_MS = 180;
const PARAGRAPH_PAUSE_MS = 280;
const MAX_BUFFER_BEFORE_CATCHUP = 1200;
const CATCHUP_CHARS_PER_TICK = 12;

function getRunKey(conversationId: string, runId: string): string {
    return `${conversationId}\u0000${runId}`;
}

function isWhitespaceOrEnd(remaining: string): boolean {
    return remaining.length === 0 || /^\s/u.test(remaining);
}

function getReadableDelay(emitted: string, remaining: string, isCatchup: boolean): number {
    if (isCatchup) return BASE_DELAY_MS;
    if (emitted.endsWith('\n\n')) return PARAGRAPH_PAUSE_MS;

    const trimmedEmission = emitted.trimEnd();
    const punctuationIsAtBoundary = trimmedEmission.length < emitted.length || isWhitespaceOrEnd(remaining);
    if (/[.!?:;]$/u.test(trimmedEmission) && punctuationIsAtBoundary) return SENTENCE_PAUSE_MS;
    if (trimmedEmission.endsWith(',') && punctuationIsAtBoundary) return COMMA_PAUSE_MS;
    return BASE_DELAY_MS;
}

function takeCodePointSlice(buffer: string, count: number): { emitted: string; remaining: string } {
    const chars = Array.from(buffer);
    return {
        emitted: chars.slice(0, count).join(''),
        remaining: chars.slice(count).join(''),
    };
}

export function useReadableTextStream(dispatchTextDelta: DispatchTextDelta): {
    enqueueDelta: EnqueueDelta;
    flushRun: FlushRun;
    clearRun: ClearRun;
    clearAll: () => void;
} {
    const dispatchRef = useRef(dispatchTextDelta);
    const buffersRef = useRef<Map<string, RunBuffer>>(new Map());

    useEffect(() => {
        dispatchRef.current = dispatchTextDelta;
    }, [dispatchTextDelta]);

    const clearTimer = useCallback((buffer: RunBuffer) => {
        if (buffer.timer) {
            clearTimeout(buffer.timer);
            buffer.timer = null;
        }
    }, []);

    const clearRun = useCallback<ClearRun>((conversationId, runId) => {
        if (runId) {
            const key = getRunKey(conversationId, runId);
            const buffer = buffersRef.current.get(key);
            if (buffer) clearTimer(buffer);
            buffersRef.current.delete(key);
            return;
        }

        for (const [key, buffer] of buffersRef.current.entries()) {
            if (buffer.conversationId !== conversationId) continue;
            clearTimer(buffer);
            buffersRef.current.delete(key);
        }
    }, [clearTimer]);

    const clearAll = useCallback(() => {
        for (const buffer of buffersRef.current.values()) {
            clearTimer(buffer);
        }
        buffersRef.current.clear();
    }, [clearTimer]);

    const scheduleNext = useCallback((key: string, delay: number) => {
        const buffer = buffersRef.current.get(key);
        if (!buffer || buffer.timer) return;

        buffer.timer = setTimeout(() => {
            buffer.timer = null;
            const current = buffersRef.current.get(key);
            if (!current) return;

            const isCatchup = current.buffer.length > MAX_BUFFER_BEFORE_CATCHUP;
            const charsPerTick = isCatchup ? CATCHUP_CHARS_PER_TICK : CHARS_PER_TICK;
            const { emitted, remaining } = takeCodePointSlice(current.buffer, charsPerTick);
            current.buffer = remaining;

            if (emitted) {
                dispatchRef.current({
                    conversationId: current.conversationId,
                    runId: current.runId,
                    delta: emitted,
                });
            }

            if (!current.buffer) {
                buffersRef.current.delete(key);
                return;
            }

            scheduleNext(key, getReadableDelay(emitted, current.buffer, isCatchup));
        }, delay);
    }, []);

    const enqueueDelta = useCallback<EnqueueDelta>((conversationId, runId, delta) => {
        if (!conversationId || !runId || !delta) return;

        const key = getRunKey(conversationId, runId);
        const existing = buffersRef.current.get(key);
        if (existing) {
            existing.buffer += delta;
            scheduleNext(key, BASE_DELAY_MS);
            return;
        }

        buffersRef.current.set(key, {
            conversationId,
            runId,
            buffer: delta,
            timer: null,
        });
        scheduleNext(key, BASE_DELAY_MS);
    }, [scheduleNext]);

    const flushRun = useCallback<FlushRun>((conversationId, runId) => {
        const key = getRunKey(conversationId, runId);
        const buffer = buffersRef.current.get(key);
        if (!buffer) return;

        clearTimer(buffer);
        buffersRef.current.delete(key);
        if (!buffer.buffer) return;

        dispatchRef.current({
            conversationId: buffer.conversationId,
            runId: buffer.runId,
            delta: buffer.buffer,
        });
    }, [clearTimer]);

    useEffect(() => clearAll, [clearAll]);

    return { enqueueDelta, flushRun, clearRun, clearAll };
}
