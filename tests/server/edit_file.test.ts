import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDefaultConfig } from '../../src/server/sandbox/config';
import { initializeSandboxWithConfig } from '../../src/server/sandbox';
import { editFile } from '../../src/server/processor/actor/edit_file';
import type { ConfirmationContext } from '../../src/server/processor/confirmation';

describe('editFile', () => {
    const testDir = path.join(os.tmpdir(), 'edit-file-tests');

    beforeEach(async () => {
        await initializeSandboxWithConfig({
            ...getDefaultConfig(),
            enabled: false,
            allowedWritePaths: [],
            deniedWritePaths: [],
        });
    });

    afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
        await initializeSandboxWithConfig({
            ...getDefaultConfig(),
            enabled: false,
        });
    });

    test('applies concurrent non-overlapping edits to the same file without losing updates', async () => {
        await fs.mkdir(testDir, { recursive: true });
        const filePath = path.join(testDir, 'notes.txt');
        await fs.writeFile(filePath, ['alpha: old', 'middle', 'beta: old'].join('\n'), 'utf-8');

        let confirmationCount = 0;
        let releaseSecondConfirmation!: () => void;
        const secondConfirmationStarted = new Promise<void>((resolve) => {
            releaseSecondConfirmation = resolve;
        });
        const confirmationContext: ConfirmationContext = {
            preferences: { skipConfirmationFor: new Set() },
            requestConfirmation: async (request) => {
                confirmationCount++;
                if (confirmationCount === 2) {
                    releaseSecondConfirmation();
                }
                if (confirmationCount === 1) {
                    await Promise.race([
                        secondConfirmationStarted,
                        new Promise(resolve => setTimeout(resolve, 25)),
                    ]);
                }
                return {
                    requestId: request.requestId,
                    selectedOptionId: 'yes',
                    timestamp: new Date().toISOString(),
                };
            },
        };

        const [firstResult, secondResult] = await Promise.all([
            editFile({
                file_path: filePath,
                old_string: 'alpha: old',
                new_string: 'alpha: new',
            }, { confirmationContext }),
            editFile({
                file_path: filePath,
                old_string: 'beta: old',
                new_string: 'beta: new',
            }, { confirmationContext }),
        ]);

        expect(firstResult.compiled).toBe(`Successfully replaced 1 occurrence in ${filePath}`);
        expect(secondResult.compiled).toBe(`Successfully replaced 1 occurrence in ${filePath}`);
        expect(confirmationCount).toBe(2);

        const finalContent = await fs.readFile(filePath, 'utf-8');
        expect(finalContent).toBe(['alpha: new', 'middle', 'beta: new'].join('\n'));
    });
});
