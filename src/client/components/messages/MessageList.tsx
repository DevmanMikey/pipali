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
    userFirstName?: string;
    hasInput?: boolean;
}

export function MessageList({ messages, conversationId, platformFrontendUrl, onDeleteMessage, onBillingContinue, onBillingDismiss, onAuthSignIn, onAuthDismiss, userFirstName, hasInput }: MessageListProps) {
    const lastUserMessageRef = useRef<HTMLDivElement>(null);
    const mainContentRef = useRef<HTMLElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const messageRefsMap = useRef<Map<number, HTMLElement>>(new Map());
    const previousConversationIdRef = useRef<string | undefined>(undefined);
    const previousMessagesLengthRef = useRef<number>(0);
    const previousThoughtsLengthRef = useRef<number>(0);
    // Track if user is near bottom (updated on scroll events)
    const isNearBottomRef = useRef<boolean>(true);
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

    // All message indices for the navigator
    const messageIndices = useMemo(
        () => messages.map((_, i) => i),
        [messages.length]
    );

    // Get the streaming message's thoughts count
    const streamingMessage = messages.find(msg => msg.role === 'assistant' && msg.isStreaming);
    const currentThoughtsLength = streamingMessage?.thoughts?.length ?? 0;

    // Track scroll position to detect if user is near bottom
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
        const threshold = 150;
        isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    }, []);

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

    // Scroll to last user message when conversation messages are freshly loaded
    // or when a new message is sent while near the bottom
    useEffect(() => {
        const prevLength = previousMessagesLengthRef.current;
        previousMessagesLengthRef.current = messages.length;

        // Scroll on first render of a populated conversation -
        // either the initial load (empty to non-empty)
        // or switch to a cached conversation (direct message array swap, so prevLength never 0).
        const isNewConversation = conversationId !== previousConversationIdRef.current;
        const isFreshLoad = messages.length > 0 && (prevLength === 0 || isNewConversation);

        if (isNewConversation) {
            previousConversationIdRef.current = conversationId;
        }

        if (isFreshLoad) {
            // Opening an actively streaming conversation: follow the growing
            // content to the bottom. Pinning to the last user message here
            // would leave newly-arriving thoughts below the fold.
            if (streamingMessage) {
                isNearBottomRef.current = true;
                requestAnimationFrame(() => {
                    const container = mainContentRef.current;
                    if (container) container.scrollTop = container.scrollHeight;
                });
                return;
            }
            // Completed conversation: anchor on last user message. Markdown,
            // KaTeX and images settle over several frames — for very long
            // conversations, over several seconds — so a single RAF scroll
            // lands on a pre-final height and the viewport ends up blank
            // until the user nudges the scrollbar. Flag it so the
            // ResizeObserver below keeps the anchor locked via scrollTop
            // delta until heights stabilize or the user intervenes.
            freshLoadInProgressRef.current = true;
            freshLoadAnchorOffsetRef.current = null;
            freshLoadExpectedScrollTopRef.current = null;
            requestAnimationFrame(() => {
                const anchor = lastUserMessageRef.current;
                const container = mainContentRef.current;
                if (!anchor || !container) return;
                anchor.scrollIntoView({ behavior: 'instant' });
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

        // Check if new messages were added (user sent a message)
        const newMessagesAdded = messages.length > prevLength && prevLength > 0;
        if (newMessagesAdded && isNearBottomRef.current) {
            // Scroll to show the new user message
            requestAnimationFrame(() => {
                lastUserMessageRef.current?.scrollIntoView({ behavior: 'smooth' });
            });
        }
    }, [conversationId, messages.length]);

    // Scroll when thoughts are added during streaming.
    // The ResizeObserver handles height-based scrolling well for level 2 (full results),
    // but at level 1 (outline) new thoughts add minimal height and STEP_END produces
    // zero height change (results are hidden), so we need an explicit scroll trigger.
    useEffect(() => {
        const prevThoughtsLength = previousThoughtsLengthRef.current;
        previousThoughtsLengthRef.current = currentThoughtsLength;

        if (currentThoughtsLength > prevThoughtsLength && isNearBottomRef.current) {
            const container = mainContentRef.current;
            requestAnimationFrame(() => {
                if (prevThoughtsLength === 0) {
                    lastUserMessageRef.current?.scrollIntoView({ behavior: 'smooth' });
                } else if (container) {
                    container.scrollTop = container.scrollHeight;
                }
            });
        }
    }, [currentThoughtsLength]);

    // Auto-scroll when content height grows during streaming.
    // Tool call results and expanded thoughts change DOM height without changing
    // messages.length or currentThoughtsLength, so the above effects miss them.
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
            if (isNearBottomRef.current) {
                // Defer scroll to after paint so hit-test coordinates stay in sync
                // with visual positions. Synchronous scrollTop updates during layout
                // can desync the compositor, making buttons visually offset from their
                // actual clickable area until the next repaint.
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        });
        observer.observe(messagesEl);
        return () => {
            observer.disconnect();
            if (stableTimer) clearTimeout(stableTimer);
        };
    }, []);

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
                                <MessageItem message={msg} platformFrontendUrl={platformFrontendUrl} onDelete={onDeleteMessage} onBillingContinue={onBillingContinue} onBillingDismiss={onBillingDismiss} onAuthSignIn={onAuthSignIn} onAuthDismiss={onAuthDismiss} />
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
