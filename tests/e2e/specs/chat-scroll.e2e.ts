import { test, expect } from '@playwright/test';
import { ChatPage } from '../helpers/page-objects';
import { Selectors } from '../helpers/selectors';

test.describe('Chat scrolling', () => {
    test('frames follow-up turns as responses grow and keeps latest output reachable', async ({ page, context }) => {
        const chatPage = new ChatPage(page);
        await context.clearCookies();
        await page.setViewportSize({ width: 1200, height: 800 });

        await chatPage.goto();
        await chatPage.sendMessage('scroll behavior setup');
        await chatPage.waitForAssistantResponse();
        await chatPage.waitForIdle();

        await page.waitForFunction(
            (selectors) => {
                const container = document.querySelector(selectors.mainContent);
                const assistant = document.querySelector(selectors.assistantMessage);
                return container instanceof HTMLElement
                    && assistant instanceof HTMLElement
                    && assistant.getBoundingClientRect().height > container.clientHeight;
            },
            Selectors,
            { timeout: 10000 }
        );

        await chatPage.mainContent.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });

        await chatPage.sendMessage('scroll behavior follow up');
        await expect(chatPage.userMessages).toHaveCount(2);
        await chatPage.waitForAssistantResponse();
        await chatPage.waitForIdle();

        await page.waitForFunction(
            (selectors) => {
                const container = document.querySelector(selectors.mainContent);
                const users = document.querySelectorAll(selectors.userMessage);
                const assistants = document.querySelectorAll(selectors.assistantMessage);
                if (!(container instanceof HTMLElement) || users.length < 2 || assistants.length < 1) return false;

                const containerRect = container.getBoundingClientRect();
                const lastUserRect = users[users.length - 1]!.getBoundingClientRect();
                const previousAssistantRect = assistants[0]!.getBoundingClientRect();
                const userTop = lastUserRect.top - containerRect.top;
                const previousAssistantBottom = previousAssistantRect.bottom - containerRect.top;

                return userTop >= 0 && userTop < 60 && previousAssistantBottom < 0;
            },
            Selectors,
            { timeout: 10000 }
        );

        const metrics = await page.evaluate((selectors) => {
            const container = document.querySelector(selectors.mainContent)!;
            const users = document.querySelectorAll(selectors.userMessage);
            const assistants = document.querySelectorAll(selectors.assistantMessage);
            const containerRect = container.getBoundingClientRect();
            const lastUserRect = users[users.length - 1]!.getBoundingClientRect();
            const previousAssistantRect = assistants[0]!.getBoundingClientRect();
            return {
                userTop: lastUserRect.top - containerRect.top,
                previousAssistantBottom: previousAssistantRect.bottom - containerRect.top,
            };
        }, Selectors);

        expect(metrics.userTop).toBeGreaterThanOrEqual(0);
        expect(metrics.userTop).toBeLessThan(60);
        expect(metrics.previousAssistantBottom).toBeLessThan(0);

        await chatPage.mainContent.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });

        const bottomMetrics = await page.evaluate((selectors) => {
            const container = document.querySelector(selectors.mainContent)!;
            const assistants = document.querySelectorAll(selectors.assistantMessage);
            const containerRect = container.getBoundingClientRect();
            const lastAssistantRect = assistants[assistants.length - 1]!.getBoundingClientRect();
            return {
                bottomGap: containerRect.bottom - lastAssistantRect.bottom,
            };
        }, Selectors);

        expect(bottomMetrics.bottomGap).toBeLessThan(80);
    });
});
