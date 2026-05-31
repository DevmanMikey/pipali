import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    augmentSchemaWithOperationType,
    createMcpToolDefinition,
    getMcpConfirmationSubType,
    handleFailedMcpToolResult,
    isMcpTool,
    parseNamespacedToolName,
    shouldRequireConfirmation,
} from '../../../src/server/processor/mcp/manager';
import type { McpToolInfo } from '../../../src/server/processor/mcp/types';

function tableName(table: unknown): string | undefined {
    return (table as { __tableName?: string }).__tableName;
}

describe('MCP Manager', () => {
    describe('isMcpTool', () => {
        test('identifies namespaced MCP tool names', () => {
            expect(isMcpTool('github__create_issue')).toBe(true);
            expect(isMcpTool('my-server__my_tool')).toBe(true);
            expect(isMcpTool('view_file')).toBe(false);
            expect(isMcpTool('')).toBe(false);
        });
    });

    describe('parseNamespacedToolName', () => {
        test('parses a namespaced MCP tool name at the first separator', () => {
            expect(parseNamespacedToolName('server__path__to__tool')).toEqual({
                serverName: 'server',
                toolName: 'path__to__tool',
            });
        });

        test('returns null for non-MCP tool names', () => {
            expect(parseNamespacedToolName('view_file')).toBeNull();
        });
    });

    describe('createMcpToolDefinition', () => {
        test('prefixes the description and augments the schema used by the director', () => {
            const tool: McpToolInfo = {
                originalName: 'create_issue',
                namespacedName: 'github__create_issue',
                serverName: 'github',
                description: 'Creates a new issue',
                inputSchema: {
                    type: 'object',
                    properties: { title: { type: 'string' } },
                    required: ['title'],
                },
            };

            const definition = createMcpToolDefinition(tool);
            const properties = definition.schema.properties as Record<string, unknown>;
            const operationType = properties.operation_type as Record<string, unknown>;

            expect(definition.name).toBe('github__create_issue');
            expect(definition.description).toBe('[MCP: github] Creates a new issue');
            expect(properties).toHaveProperty('title');
            expect(operationType.enum).toEqual(['safe', 'unsafe']);
            expect(definition.schema.required).toEqual(['title', 'operation_type']);
        });
    });

    describe('augmentSchemaWithOperationType', () => {
        test('adds operation_type while preserving existing properties and required fields', () => {
            const augmented = augmentSchemaWithOperationType({
                type: 'object',
                properties: { title: { type: 'string' }, count: { type: 'number' } },
                required: ['title'],
            });

            const properties = augmented.properties as Record<string, unknown>;
            const operationType = properties.operation_type as Record<string, unknown>;

            expect(properties).toHaveProperty('title');
            expect(properties).toHaveProperty('count');
            expect(operationType.type).toBe('string');
            expect(operationType.enum).toEqual(['safe', 'unsafe']);
            expect(augmented.required).toEqual(['title', 'operation_type']);
        });

        test('creates required when the original schema has none', () => {
            const augmented = augmentSchemaWithOperationType({ type: 'object', properties: {} });

            expect(augmented.required).toEqual(['operation_type']);
        });
    });

    describe('shouldRequireConfirmation', () => {
        test('applies the server confirmation mode to the operation type', () => {
            expect(shouldRequireConfirmation('never', 'unsafe')).toBe(false);
            expect(shouldRequireConfirmation('always', 'safe')).toBe(true);
            expect(shouldRequireConfirmation('unsafe_only', 'safe')).toBe(false);
            expect(shouldRequireConfirmation('unsafe_only', 'unsafe')).toBe(true);
            expect(shouldRequireConfirmation('unsafe_only', undefined)).toBe(true);
        });
    });

    describe('getMcpConfirmationSubType', () => {
        test('builds per-server confirmation subtypes and defaults unknown operations to unsafe', () => {
            expect(getMcpConfirmationSubType('github', 'safe')).toBe('github:safe');
            expect(getMcpConfirmationSubType('github', 'unsafe')).toBe('github:unsafe');
            expect(getMcpConfirmationSubType('github', undefined)).toBe('github:unsafe');
        });
    });

    describe('handleFailedMcpToolResult', () => {
        const updates: Record<string, any>[] = [];

        beforeEach(() => {
            updates.length = 0;
            globalThis.__pipaliUnitDb = {
                update(table, values) {
                    if (tableName(table) === 'mcp_server') {
                        updates.push(values as Record<string, any>);
                    }
                },
            };
        });

        afterEach(() => {
            globalThis.__pipaliUnitDb = undefined;
        });

        test('marks the server auth_required for auth-required tool failures', async () => {
            const message = await handleFailedMcpToolResult('oauth-server', 'oauth-server__list_items', {
                success: false,
                content: [],
                error: 'Reauthorization required',
                authRequired: true,
            });

            expect(updates).toHaveLength(1);
            expect(updates[0]).toMatchObject({
                oauthStatus: 'auth_required',
                lastError: 'Reauthorization required',
            });
            expect(updates[0]!.updatedAt).toBeInstanceOf(Date);
            expect(message).toBe('Error executing MCP tool oauth-server__list_items: Reauthorization required');
        });

        test('does not update OAuth state for ordinary tool failures', async () => {
            const message = await handleFailedMcpToolResult('oauth-server', 'oauth-server__list_items', {
                success: false,
                content: [],
                error: 'Tool failed',
            });

            expect(updates).toHaveLength(0);
            expect(message).toBe('Error executing MCP tool oauth-server__list_items: Tool failed');
        });

        test('preserves Chrome setup guidance for remote debugging failures', async () => {
            const message = await handleFailedMcpToolResult('chrome-browser', 'chrome-browser__list_pages', {
                success: false,
                content: [],
                error: 'Open chrome://inspect/#remote-debugging first',
            });

            expect(message).toContain('Allow remote debugging');
        });
    });
});
