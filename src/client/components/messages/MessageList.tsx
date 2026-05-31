// Message list container with empty state

import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { Message } from '../../types';
import { MessageItem } from './MessageItem';
import { MessageNavigator } from './MessageNavigator';
import { EmptyHomeState } from '../home/EmptyHomeState';

interface MessageListProps {
    messages: Message[];
    conversationId?: string;
    platformFrontendUrl?: string;
    onDeleteMessage?: (messageId: string, role: 'user' | 'assistant') => void;
    onBillingContinue?: (messageId: string) => void;
    onBillingDismiss?: (messageId: string) => void;
    onAuthSignIn?: (messageId: string) => void;
    onAuthDismiss?: (messageId: string) => void;
    onRunErrorDismiss?: (messageId: string) => void;
    userFirstName?: string;
    hasInput?: boolean;
}

export function MessageList({ messages, conversationId, platformFrontendUrl, onDeleteMessage, onBillingContinue, onBillingDismiss, onAuthSignIn, onAuthDismiss, onRunErrorDismiss, userFirstName, hasInput }: MessageListProps) {
    const lastUserMessageRef = useRef<HTMLDivElement>(null);
    const mainContentRef = useRef<HTMLElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const messageRefsMap = useRef<Map<number, HTMLElement>>(new Map());
    const previousConversationIdRef = useRef<string | undefined>(undefined);
    const previousMessagesLengthRef = useRef<number>(0);
    const previousLastUserStableIdRef = useRef<string | undefined>(undefined);
    const previousHasStreamingAssistantRef = useRef(false);
    const previousThoughtsLengthRef = useRef(0);
    const turnScrollInProgressRef = useRef(false);
    // While a freshly loaded conversation's content is still settling (markdown,
    // KaTeX, images resolve after mount), keep re-anchoring the viewport on the
    // last user message instead of auto-scrolling to bottom.
    const freshLoadInProgressRef = useRef<boolean>(false);
    // Track the anchor element's offsetTop so we can correct scroll position
    // by delta as content grows/shrinks above it, instead of re-running
    // scrollIntoView (which can no-op if the ref is briefly null between renders).
    const freshLoadAnchorOffsetRef = useRef<number | null>(null);
    // scrollTop we expect after our programmatic scrolls — a divergence from
    // this means the user scrolled, so cancel anchor tracking.
    const freshLoadExpectedScrollTopRef = useRef<number | null>(null);

    // Find the index of the last user message
    const lastUserMessageIndex = messages.findLastIndex(msg => msg.role === 'user');
    const lastUserStableId = lastUserMessageIndex >= 0 ? messages[lastUserMessageIndex]?.stableId : undefined;
    const streamingMessage = messages.find(msg => msg.role === 'assistant' && msg.isStreaming);
    const hasStreamingAssistant = !!streamingMessage;
    const currentThoughtsLength = streamingMessage?.thoughts?.length ?? 0;

    // All message indices for the navigator
    const messageIndices = useMemo(
        () => messages.map((_, i) => i),
        [messages.length]
    );

    // Track scrolls that should cancel fresh-load anchoring.
    const handleScroll = useCallback(() => {
        const container = mainContentRef.current;
        if (!container) return;
        // If the user scrolls during a fresh-load anchor window, stop tracking.
        // We compare against the scrollTop we last set programmatically; a
        // divergence means this scroll came from the user, not from us.
        if (freshLoadInProgressRef.current && freshLoadExpectedScrollTopRef.current !== null) {
            if (Math.abs(container.scrollTop - freshLoadExpectedScrollTopRef.current) > 10) {
                freshLoadInProgressRef.current = false;
                freshLoadAnchorOffsetRef.current = null;
                freshLoadExpectedScrollTopRef.current = null;
            }
        }
    }, []);

    const cancelScrollTrackingForUserInput = useCallback(() => {
        freshLoadInProgressRef.current = false;
        freshLoadAnchorOffsetRef.current = null;
        freshLoadExpectedScrollTopRef.current = null;
        turnScrollInProgressRef.current = false;
    }, []);

    const getLastUserTargetScrollTop = useCallback(() => {
        const anchor = lastUserMessageRef.current;
        const container = mainContentRef.current;
        const messagesEl = messagesRef.current;
        if (!anchor || !container || !messagesEl) return null;

        const paddingTop = Number.parseFloat(getComputedStyle(messagesEl).paddingTop) || 0;
        const anchorRect = anchor.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return Math.max(0, container.scrollTop + anchorRect.top - containerRect.top - paddingTop);
    }, []);

    const scrollLastUserTowardTurnStart = useCallback((behavior: ScrollBehavior, afterScroll?: () => void) => {
        const container = mainContentRef.current;
        const targetScrollTop = getLastUserTargetScrollTop();
        if (!container || targetScrollTop === null) return;

        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const nextScrollTop = Math.min(targetScrollTop, maxScrollTop);

        if (nextScrollTop <= container.scrollTop + 1) {
            if (container.scrollTop >= targetScrollTop - 1) {
                turnScrollInProgressRef.current = false;
            }
            afterScroll?.();
            return;
        }

        container.scrollTo({ top: nextScrollTop, behavior });
        if (nextScrollTop >= targetScrollTop - 1) {
            turnScrollInProgressRef.current = false;
        }
        afterScroll?.();
    }, [getLastUserTargetScrollTop]);

    const scheduleScrollLastUserTowardTurnStart = useCallback((behavior: ScrollBehavior, afterScroll?: () => void) => {
        requestAnimationFrame(() => scrollLastUserTowardTurnStart(behavior, afterScroll));
    }, [scrollLastUserTowardTurnStart]);

    // Set up scroll listener
    useEffect(() => {
        const container = mainContentRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll, { passive: true });
            // Initial check
            handleScroll();
            return () => container.removeEventListener('scroll', handleScroll);
        }
    }, [handleScroll]);

    useEffect(() => {
        const container = mainContentRef.current;
        if (!container) return;

        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (target?.closest('input, textarea, [contenteditable="true"]')) return;
            if (['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
                cancelScrollTrackingForUserInput();
            }
        };

        container.addEventListener('wheel', cancelScrollTrackingForUserInput, { passive: true });
        container.addEventListener('touchstart', cancelScrollTrackingForUserInput, { passive: true });
        window.addEventListener('keydown', onKeyDown);
        return () => {
            container.removeEventListener('wheel', cancelScrollTrackingForUserInput);
            container.removeEventListener('touchstart', cancelScrollTrackingForUserInput);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [cancelScrollTrackingForUserInput]);

    // Scroll to last user message when conversation messages are freshly loaded
    // or when a new user turn is sent.
    useEffect(() => {
        const prevLength = previousMessagesLengthRef.current;
        const prevLastUserStableId = previousLastUserStableIdRef.current;
        previousMessagesLengthRef.current = messages.length;
        previousLastUserStableIdRef.current = lastUserStableId;

        // Scroll on first render of a populated conversation -
        // either the initial load (empty to non-empty)
        // or switch to a cached conversation (direct message array swap, so prevLength never 0).
        const isNewConversation = conversationId !== previousConversationIdRef.current;
        const isFreshLoad = messages.length > 0 && (prevLength === 0 || isNewConversation);

        if (isNewConversation) {
            previousConversationIdRef.current = conversationId;
            turnScrollInProgressRef.current = false;
        }

        if (isFreshLoad) {
            // Anchor on last user message. Markdown,
            // KaTeX and images settle over several frames — for very long
            // conversations, over several seconds — so a single RAF scroll
            // lands on a pre-final height and the viewport ends up blank
            // until the user nudges the scrollbar. Flag it so the
            // ResizeObserver below keeps the anchor locked via scrollTop
            // delta until heights stabilize or the user intervenes.
            freshLoadInProgressRef.current = true;
            freshLoadAnchorOffsetRef.current = null;
            freshLoadExpectedScrollTopRef.current = null;
            scheduleScrollLastUserTowardTurnStart('instant', () => {
                const anchor = lastUserMessageRef.current;
                const container = mainContentRef.current;
                if (!anchor || !container) return;
                freshLoadAnchorOffsetRef.current = anchor.offsetTop;
                freshLoadExpectedScrollTopRef.current = container.scrollTop;
            });
            // Hard cap — long conversations can keep relayouting well past
            // a few seconds, so set this generously.
            const fallback = setTimeout(() => {
                freshLoadInProgressRef.current = false;
                freshLoadAnchorOffsetRef.current = null;
                freshLoadExpectedScrollTopRef.current = null;
            }, 15000);
            return () => clearTimeout(fallback);
        }

        const hasNewUserTurn = messages.length > prevLength && !!lastUserStableId && lastUserStableId !== prevLastUserStableId && prevLength > 0;
        if (hasNewUserTurn) {
            freshLoadInProgressRef.current = false;
            freshLoadAnchorOffsetRef.current = null;
            freshLoadExpectedScrollTopRef.current = null;
            turnScrollInProgressRef.current = true;
            scheduleScrollLastUserTowardTurnStart('smooth');
        }
    }, [conversationId, lastUserStableId, messages.length, scheduleScrollLastUserTowardTurnStart]);

    useEffect(() => {
        const didFinishStreaming = previousHasStreamingAssistantRef.current && !hasStreamingAssistant;
        previousHasStreamingAssistantRef.current = hasStreamingAssistant;

        if (didFinishStreaming && turnScrollInProgressRef.current) {
            requestAnimationFrame(() => {
                scrollLastUserTowardTurnStart('auto');
                turnScrollInProgressRef.current = false;
            });
        }
    }, [hasStreamingAssistant, scrollLastUserTowardTurnStart]);

    useEffect(() => {
        const prevThoughtsLength = previousThoughtsLengthRef.current;
        previousThoughtsLengthRef.current = currentThoughtsLength;

        if (currentThoughtsLength > prevThoughtsLength && turnScrollInProgressRef.current) {
            requestAnimationFrame(() => scrollLastUserTowardTurnStart('auto'));
        }
    }, [currentThoughtsLength, scrollLastUserTowardTurnStart]);

    // Keep fresh-load anchoring stable while content height settles.
    useEffect(() => {
        const container = mainContentRef.current;
        const messagesEl = messagesRef.current;
        if (!container || !messagesEl) return;

        let stableTimer: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver(() => {
            if (freshLoadInProgressRef.current) {
                // Correct scroll by the delta the anchor has shifted since
                // the last observation. More robust than re-calling
                // scrollIntoView (which no-ops if the ref is briefly null
                // between renders and can jitter with inline-level anchors).
                const anchor = lastUserMessageRef.current;
                if (anchor) {
                    const currentOffset = anchor.offsetTop;
                    const savedOffset = freshLoadAnchorOffsetRef.current;
                    if (savedOffset === null) {
                        freshLoadAnchorOffsetRef.current = currentOffset;
                    } else if (currentOffset !== savedOffset) {
                        const delta = currentOffset - savedOffset;
                        requestAnimationFrame(() => {
                            container.scrollTop += delta;
                            freshLoadAnchorOffsetRef.current = anchor.offsetTop;
                            freshLoadExpectedScrollTopRef.current = container.scrollTop;
                        });
                    }
                }
                // Clear the flag once sizes stop changing for 1500ms.
                // 300ms was too eager for long conversations — markdown +
                // KaTeX + code highlighting fires resizes every ~16-50ms
                // without a 300ms quiet period for many seconds.
                if (stableTimer) clearTimeout(stableTimer);
                stableTimer = setTimeout(() => {
                    freshLoadInProgressRef.current = false;
                    freshLoadAnchorOffsetRef.current = null;
                    freshLoadExpectedScrollTopRef.current = null;
                    stableTimer = null;
                }, 1500);
                return;
            }

            if (turnScrollInProgressRef.current) {
                requestAnimationFrame(() => scrollLastUserTowardTurnStart('auto'));
            }
        });
        observer.observe(messagesEl);
        return () => {
            observer.disconnect();
            if (stableTimer) clearTimeout(stableTimer);
        };
    }, [scrollLastUserTowardTurnStart]);

    return (
        <main className="main-content" ref={mainContentRef}>
            <div className="messages-container">
                {messages.length === 0 ? (
                    <EmptyHomeState userFirstName={userFirstName} hasInput={hasInput} />
                ) : (
                    <div className="messages" ref={messagesRef}>
                        {messages.map((msg, index) => (
                            <div
                                key={msg.stableId}
                                ref={el => {
                                    if (index === lastUserMessageIndex) lastUserMessageRef.current = el;
                                    if (el) messageRefsMap.current.set(index, el);
                                    else messageRefsMap.current.delete(index);
                                }}
                            >
                                <MessageItem message={msg} platformFrontendUrl={platformFrontendUrl} onDelete={onDeleteMessage} onBillingContinue={onBillingContinue} onBillingDismiss={onBillingDismiss} onAuthSignIn={onAuthSignIn} onAuthDismiss={onAuthDismiss} onRunErrorDismiss={onRunErrorDismiss} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <MessageNavigator
                messageIndices={messageIndices}
                scrollContainerRef={mainContentRef}
                messageRefs={messageRefsMap}
            />
        </main>
    );
}
