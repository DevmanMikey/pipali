import { describe, expect, test } from 'bun:test';
import { askUser } from '../../src/server/processor/actor/ask_user';
import { createEmptyPreferences, type ConfirmationContext, type ConfirmationResponse } from '../../src/server/processor/confirmation';

function confirmationContext(response: Omit<ConfirmationResponse, 'requestId' | 'timestamp'>): ConfirmationContext {
    return {
        preferences: createEmptyPreferences(),
        requestConfirmation: async request => ({
            requestId: request.requestId,
            timestamp: new Date().toISOString(),
            ...response,
        }),
    };
}

describe('askUser', () => {
    test('returns the selected answer with attached files for the next model turn', async () => {
        const result = await askUser(
            {
                title: 'Which file should I use?',
                options: ['Use attached file', 'Skip it'],
            },
            confirmationContext({
                selectedOptionId: 'option_0',
                attachments: [
                    { path: '/tmp/pipali-upload/report.pdf', name: 'report.pdf' },
                ],
            })
        );

        expect(result.selectedLabel).toBe('Use attached file');
        expect(result.compiled).toContain('User selected: Use attached file');
        expect(result.compiled).toContain('<attached_files>');
        expect(result.compiled).toContain('- /tmp/pipali-upload/report.pdf');
        expect(result.compiled).toContain('</attached_files>');
    });
});
