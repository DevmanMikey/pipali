import { useCallback, useEffect, useRef } from 'react';
import type { Message } from '../../types';

interface UseMessageListScrollOptions {
    messages: Message[];
    conversationId?: string;
    isProcessing: boolean;
}

interface ActiveRunState {
    message?: Message;
    hasActiveRun: boolean;
}

interface FreshLoadAnchor {
    // The last user message can shift as markdown/code/math/images settle.
    // Keep its previous offset so ResizeObserver can preserve the viewport by delta.
    anchorOffset: number | null;
    // Programmatic scrolls update this; a later mismatch means the user scrolled.
    expectedScrollTop: number | null;
}

const USER_SCROLL_TOLERANCE = 10;
const FRESH_LOAD_TIMEOUT_MS = 15000;
const FRESH_LOAD_STABLE_MS = 1500;
const ACTIVE_RUN_SCROLL_INTERVAL_MS = 250;
const TAIL_PADDING = 16;

function getActiveRunState(messages: Message[], isProcessing: boolean): ActiveRunState {
    const streamingMessage = messages.find(msg => msg.role === 'assistant' && msg.isStreaming);
    const fallbackMessage = isProcessing ? messages.findLast(msg => msg.role === 'assistant') : undefined;
    return {
        message: streamingMessage || fallbackMessage,
        hasActiveRun: isProcessing || !!streamingMessage,
    };
}

function clampScrollTop(container: HTMLElement, scrollTop: number): number {
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    return Math.min(Math.max(0, scrollTop), maxScrollTop);
}

function scrollToTop(container: HTMLElement, scrollTop: number, behavior: ScrollBehavior) {
    const nextScrollTop = clampScrollTop(container, scrollTop);
    if (Math.abs(container.scrollTop - nextScrollTop) <= 1) return;

    container.scrollTo({ top: nextScrollTop, behavior });
}

function scheduleAfterLayout(callback: () => void) {
    requestAnimationFrame(callback);
}

function scheduleAfterSettledLayout(callback: () => void) {
    // Some thought rows render in two phases: React commits the row, then nested
    // markdown/tool-result content changes its height. Run once immediately and
    // once on the next frame so tail-following lands after both phases.
    requestAnimationFrame(() => {
        callback();
        requestAnimationFrame(callback);
    });
}

export function useMessageListScroll({ messages, conversationId, isProcessing }: UseMessageListScrollOptions) {
    const mainContentRef = useRef<HTMLElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
    const messageRefsMap = useRef<Map<number, HTMLElement>>(new Map());

    const previousConversationIdRef = useRef<string | undefined>(undefined);
    const previousMessagesLengthRef = useRef(0);
    const previousLastUserStableIdRef = useRef<string | undefined>(undefined);
    const previousHasActiveRunRef = useRef(false);
    const previousActiveRunStableIdRef = useRef<string | undefined>(undefined);
    const previousThoughtsLengthRef = useRef(0);

    const freshLoadAnchorRef = useRef<FreshLoadAnchor | null>(null);
    // New turns first frame the user's prompt at the top of the viewport.
    const isFramingTurnStartRef = useRef(false);
    // True while a turn we initiated is in progress (kept following its output).
    const shouldFrameTurnAfterRunRef = useRef(false);
    // While true, new trajectory/output growth keeps the live tail visible.
    const isFollowingActiveRunRef = useRef(false);

    const lastUserMessageIndex = messages.findLastIndex(msg => msg.role === 'user');
    const lastUserStableId = lastUserMessageIndex >= 0 ? messages[lastUserMessageIndex]?.stableId : undefined;
    const activeRun = getActiveRunState(messages, isProcessing);
    const activeRunStableId = activeRun.message?.stableId;
    const currentThoughtsLength = activeRun.message?.thoughts?.length ?? 0;
    const lastMessage = messages.at(-1);
    const latestAssistantContentLength = lastMessage?.role === 'assistant'
        ? lastMessage.content.length
        : 0;

    const stopFreshLoadAnchor = useCallback(() => {
        freshLoadAnchorRef.current = null;
    }, []);

    const cancelManagedScroll = useCallback(() => {
        stopFreshLoadAnchor();
        isFramingTurnStartRef.current = false;
        shouldFrameTurnAfterRunRef.current = false;
        isFollowingActiveRunRef.current = false;
    }, [stopFreshLoadAnchor]);

    const getElementTargetScrollTop = useCallback((anchor: HTMLElement) => {
        const container = mainContentRef.current;
        const messagesEl = messagesRef.current;
        if (!container || !messagesEl) return null;

        const paddingTop = Number.parseFloat(getComputedStyle(messagesEl).paddingTop) || 0;
        const anchorRect = anchor.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return container.scrollTop + anchorRect.top - containerRect.top - paddingTop;
    }, []);

    const getLastUserTargetScrollTop = useCallback(() => {
        const anchor = lastUserMessageRef.current;
        if (!anchor) return null;

        return getElementTargetScrollTop(anchor);
    }, [getElementTargetScrollTop]);

    const getLastAssistantMessage = useCallback(() => {
        const assistantMessages = messagesRef.current?.querySelectorAll('.assistant-message');
        const assistant = assistantMessages?.[assistantMessages.length - 1];
        return assistant instanceof HTMLElement ? assistant : null;
    }, []);

    const isUserMessageInFrame = useCallback(() => {
        const container = mainContentRef.current;
        const anchor = lastUserMessageRef.current;
        if (!container || !anchor) return false;

        const containerRect = container.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        // Framed only while the prompt's own top is still at/below the viewport top.
        // A long trajectory scrolls it above the top, which flips this to false.
        return anchorRect.top >= containerRect.top - TAIL_PADDING;
    }, []);

    const scrollLastUserTowardTurnStart = useCallback((behavior: ScrollBehavior, afterScroll?: () => void) => {
        const container = mainContentRef.current;
        const targetScrollTop = getLastUserTargetScrollTop();
        if (!container || targetScrollTop === null) return;

        const nextScrollTop = clampScrollTop(container, targetScrollTop);
        if (nextScrollTop <= container.scrollTop + 1) {
            if (container.scrollTop >= targetScrollTop - 1) {
                isFramingTurnStartRef.current = false;
            }
            afterScroll?.();
            return;
        }

        container.scrollTo({ top: nextScrollTop, behavior });
        if (nextScrollTop >= targetScrollTop - 1) {
            isFramingTurnStartRef.current = false;
        }
        afterScroll?.();
    }, [getLastUserTargetScrollTop]);

    const scheduleScrollLastUserTowardTurnStart = useCallback((behavior: ScrollBehavior, afterScroll?: () => void) => {
        scheduleAfterLayout(() => scrollLastUserTowardTurnStart(behavior, afterScroll));
    }, [scrollLastUserTowardTurnStart]);

    const getActiveRunTail = useCallback(() => {
        const activeAssistant = getLastAssistantMessage();
        const tailCandidates = activeAssistant?.querySelectorAll('.thought-item, .message-content');

        // Follow the last visible part of the active assistant message. Thoughts
        // render before streamed content/spinner, so the final candidate covers
        // both trajectory-only runs and runs that are already emitting an answer.
        if (tailCandidates?.length) return tailCandidates[tailCandidates.length - 1];
        return activeAssistant;
    }, [getLastAssistantMessage]);

    const scrollActiveRunTail = useCallback((behavior: ScrollBehavior) => {
        const container = mainContentRef.current;
        if (!container) return;

        const tailTarget = getActiveRunTail();
        if (!(tailTarget instanceof HTMLElement)) {
            scrollToTop(container, container.scrollHeight, behavior);
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const targetRect = tailTarget.getBoundingClientRect();
        let nextScrollTop = container.scrollTop;

        if (targetRect.bottom > containerRect.bottom - TAIL_PADDING) {
            nextScrollTop += targetRect.bottom - containerRect.bottom + TAIL_PADDING;
        } else if (targetRect.top < containerRect.top + TAIL_PADDING) {
            nextScrollTop += targetRect.top - containerRect.top - TAIL_PADDING;
        } else {
            return;
        }

        // Decide live, every follow: while answer text is on screen and the prompt
        // is still in frame, keep the prompt framed (cap at its top). Pure trajectory
        // or an already-scrolled-away prompt free-follows the tail instead. The answer
        // text is fed in bursts that clear and refill, so this is read live rather
        // than latched at a single "text started" moment. `:not(.streaming)` excludes
        // the placeholder dots, which also render as `.message-content`.
        const hasAnswerText = !!getLastAssistantMessage()?.querySelector('.message-content:not(.streaming)');
        if (hasAnswerText && isUserMessageInFrame()) {
            const userStartScrollTop = getLastUserTargetScrollTop();
            if (userStartScrollTop !== null && nextScrollTop > userStartScrollTop) {
                nextScrollTop = userStartScrollTop;
            }
        }

        scrollToTop(container, nextScrollTop, behavior);
    }, [getActiveRunTail, getLastAssistantMessage, getLastUserTargetScrollTop, isUserMessageInFrame]);

    const scheduleScrollActiveRunTail = useCallback((behavior: ScrollBehavior) => {
        scheduleAfterSettledLayout(() => scrollActiveRunTail(behavior));
    }, [scrollActiveRunTail]);

    const startFreshLoadAnchor = useCallback(() => {
        freshLoadAnchorRef.current = {
            anchorOffset: null,
            expectedScrollTop: null,
        };

        scheduleScrollLastUserTowardTurnStart('instant', () => {
            const anchor = lastUserMessageRef.current;
            const container = mainContentRef.current;
            if (!anchor || !container || !freshLoadAnchorRef.current) return;

            freshLoadAnchorRef.current = {
                anchorOffset: anchor.offsetTop,
                expectedScrollTop: container.scrollTop,
            };
        });
    }, [scheduleScrollLastUserTowardTurnStart]);

    const registerMessageRef = useCallback((index: number, el: HTMLDivElement | null) => {
        if (index === lastUserMessageIndex) {
            lastUserMessageRef.current = el;
        }

        if (el) {
            messageRefsMap.current.set(index, el);
        } else {
            messageRefsMap.current.delete(index);
        }
    }, [lastUserMessageIndex]);

    // Any direct user scroll/input should stop managed anchoring immediately.
    useEffect(() => {
        const container = mainContentRef.current;
        if (!container) return;

        const handleScroll = () => {
            const freshLoadAnchor = freshLoadAnchorRef.current;
            if (!freshLoadAnchor || freshLoadAnchor.expectedScrollTop === null) return;

            if (Math.abs(container.scrollTop - freshLoadAnchor.expectedScrollTop) > USER_SCROLL_TOLERANCE) {
                stopFreshLoadAnchor();
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => container.removeEventListener('scroll', handleScroll);
    }, [stopFreshLoadAnchor]);

    // Wheel/touch/key navigation is explicit user intent, so stop auto-scroll.
    useEffect(() => {
        const container = mainContentRef.current;
        if (!container) return;

        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (target?.closest('input, textarea, [contenteditable="true"]')) return;
            if (['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
                cancelManagedScroll();
            }
        };

        container.addEventListener('wheel', cancelManagedScroll, { passive: true });
        container.addEventListener('touchstart', cancelManagedScroll, { passive: true });
        window.addEventListener('keydown', onKeyDown);
        return () => {
            container.removeEventListener('wheel', cancelManagedScroll);
            container.removeEventListener('touchstart', cancelManagedScroll);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [cancelManagedScroll]);

    // Fresh loads and new turns both anchor around the most recent user message.
    useEffect(() => {
        const prevLength = previousMessagesLengthRef.current;
        const prevLastUserStableId = previousLastUserStableIdRef.current;
        previousMessagesLengthRef.current = messages.length;
        previousLastUserStableIdRef.current = lastUserStableId;

        const isNewConversation = conversationId !== previousConversationIdRef.current;
        const isFreshLoad = !activeRun.hasActiveRun && messages.length > 0 && (prevLength === 0 || isNewConversation);

        if (isNewConversation) {
            previousConversationIdRef.current = conversationId;
            isFramingTurnStartRef.current = false;
            shouldFrameTurnAfterRunRef.current = false;
            if (!activeRun.hasActiveRun) {
                isFollowingActiveRunRef.current = false;
            }
        }

        if (isFreshLoad) {
            // Historical conversations can relayout for several seconds after
            // mount; ResizeObserver below keeps the anchor fixed during that window.
            startFreshLoadAnchor();
            const fallback = setTimeout(stopFreshLoadAnchor, FRESH_LOAD_TIMEOUT_MS);
            return () => clearTimeout(fallback);
        }

        const hasNewUserTurn = messages.length > prevLength && !!lastUserStableId && lastUserStableId !== prevLastUserStableId && prevLength > 0;
        if (hasNewUserTurn) {
            stopFreshLoadAnchor();
            isFramingTurnStartRef.current = true;
            shouldFrameTurnAfterRunRef.current = true;
            isFollowingActiveRunRef.current = true;
            scheduleScrollLastUserTowardTurnStart('smooth');
        }
    }, [
        conversationId,
        activeRun.hasActiveRun,
        lastUserStableId,
        messages.length,
        scheduleScrollLastUserTowardTurnStart,
        startFreshLoadAnchor,
        stopFreshLoadAnchor,
    ]);

    // Active runs follow the latest trajectory/output. The live cap in
    // scrollActiveRunTail decides per-follow whether to keep the prompt or the
    // response framed, so completion just stops following — it never restores the
    // prompt: wherever the last live follow left the scroll is the final position.
    useEffect(() => {
        const previousActiveRunStableId = previousActiveRunStableIdRef.current;
        const didFinishActiveRun = previousHasActiveRunRef.current && !activeRun.hasActiveRun;
        const didStartActiveRun = activeRun.hasActiveRun && (
            !previousHasActiveRunRef.current || activeRunStableId !== previousActiveRunStableId
        );
        previousHasActiveRunRef.current = activeRun.hasActiveRun;
        previousActiveRunStableIdRef.current = activeRunStableId;

        if (didStartActiveRun) {
            stopFreshLoadAnchor();
            isFollowingActiveRunRef.current = true;
            if (currentThoughtsLength > 0) {
                scheduleScrollActiveRunTail('auto');
            }
        }

        if (didFinishActiveRun) {
            isFollowingActiveRunRef.current = false;
            shouldFrameTurnAfterRunRef.current = false;
            isFramingTurnStartRef.current = false;
        }
    }, [
        activeRun.hasActiveRun,
        activeRunStableId,
        currentThoughtsLength,
        scheduleScrollActiveRunTail,
        stopFreshLoadAnchor,
    ]);

    useEffect(() => {
        if (activeRun.hasActiveRun || !shouldFrameTurnAfterRunRef.current || latestAssistantContentLength === 0) return;

        // Some short mock/provider paths append the final answer without a visible
        // active-run transition, so content length is the completion signal.
        isFollowingActiveRunRef.current = false;
        shouldFrameTurnAfterRunRef.current = false;
        isFramingTurnStartRef.current = false;
    }, [activeRun.hasActiveRun, latestAssistantContentLength]);

    useEffect(() => {
        if (!activeRun.hasActiveRun || currentThoughtsLength === 0) return;

        // Trajectory rows can expand from tool results without changing the
        // thoughts array length, so poll while the run is active.
        const interval = setInterval(() => {
            if (isFollowingActiveRunRef.current) {
                scrollActiveRunTail('auto');
            }
        }, ACTIVE_RUN_SCROLL_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [activeRun.hasActiveRun, currentThoughtsLength, scrollActiveRunTail]);

    // Follow the live answer tail as it streams in. scrollActiveRunTail decides
    // live whether to keep the prompt framed or follow the response.
    useEffect(() => {
        if (!activeRun.hasActiveRun || latestAssistantContentLength === 0) return;
        if (!isFollowingActiveRunRef.current) return;

        scheduleScrollActiveRunTail('auto');
    }, [activeRun.hasActiveRun, latestAssistantContentLength, scheduleScrollActiveRunTail]);

    // Thoughts length is the fast path for ordinary trajectory append events.
    useEffect(() => {
        const prevThoughtsLength = previousThoughtsLengthRef.current;
        previousThoughtsLengthRef.current = currentThoughtsLength;

        if (currentThoughtsLength > prevThoughtsLength && isFollowingActiveRunRef.current && (activeRun.hasActiveRun || shouldFrameTurnAfterRunRef.current)) {
            scheduleScrollActiveRunTail('auto');
            return;
        }

        if (currentThoughtsLength > prevThoughtsLength && isFramingTurnStartRef.current) {
            scheduleAfterLayout(() => scrollLastUserTowardTurnStart('auto'));
        }
    }, [activeRun.hasActiveRun, currentThoughtsLength, scheduleScrollActiveRunTail, scrollLastUserTowardTurnStart]);

    // Content can reflow after render; keep the active managed scroll mode locked.
    useEffect(() => {
        const container = mainContentRef.current;
        const messagesEl = messagesRef.current;
        if (!container || !messagesEl) return;

        let stableTimer: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver(() => {
            const freshLoadAnchor = freshLoadAnchorRef.current;

            if (freshLoadAnchor) {
                const anchor = lastUserMessageRef.current;
                if (anchor) {
                    const currentOffset = anchor.offsetTop;
                    if (freshLoadAnchor.anchorOffset === null) {
                        freshLoadAnchor.anchorOffset = currentOffset;
                    } else if (currentOffset !== freshLoadAnchor.anchorOffset) {
                        const delta = currentOffset - freshLoadAnchor.anchorOffset;
                        scheduleAfterLayout(() => {
                            const currentFreshLoadAnchor = freshLoadAnchorRef.current;
                            if (!currentFreshLoadAnchor) return;

                            container.scrollTop += delta;
                            currentFreshLoadAnchor.anchorOffset = anchor.offsetTop;
                            currentFreshLoadAnchor.expectedScrollTop = container.scrollTop;
                        });
                    }
                }

                if (stableTimer) clearTimeout(stableTimer);
                stableTimer = setTimeout(() => {
                    stopFreshLoadAnchor();
                    stableTimer = null;
                }, FRESH_LOAD_STABLE_MS);
                return;
            }

            if (activeRun.hasActiveRun && isFollowingActiveRunRef.current) {
                scheduleScrollActiveRunTail('auto');
                return;
            }

            if (isFramingTurnStartRef.current) {
                scheduleAfterLayout(() => scrollLastUserTowardTurnStart('auto'));
            }
        });
        observer.observe(messagesEl);
        return () => {
            observer.disconnect();
            if (stableTimer) clearTimeout(stableTimer);
        };
    }, [
        activeRun.hasActiveRun,
        scheduleScrollActiveRunTail,
        scrollLastUserTowardTurnStart,
        stopFreshLoadAnchor,
    ]);

    return {
        activeRunStableId,
        hasActiveRun: activeRun.hasActiveRun,
        mainContentRef,
        messageRefsMap,
        messagesRef,
        registerMessageRef,
    };
}
