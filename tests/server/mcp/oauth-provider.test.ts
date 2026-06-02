import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    clearMcpOAuthState,
    DbMcpOAuthProvider,
    getMcpOAuthState,
    saveMcpOAuthResourceMetadataUrl,
} from '../../../src/server/processor/mcp/oauth-provider';

const oauthStateTable = 'mcp_oauth_state';
const serverTable = 'mcp_server';

function tableName(table: unknown): string | undefined {
    return (table as { __tableName?: string }).__tableName;
}

function installUnitDb() {
    const oauthStates = new Map<number, Record<string, any>>();
    const serverUpdates: Record<string, any>[] = [];

    globalThis.__pipaliUnitDb = {
        select(table) {
            if (tableName(table) !== oauthStateTable) return [];
            const rows = Array.from(oauthStates.values());
            return rows.length > 0 ? [rows[0]] : [];
        },
        insert(table, values) {
            if (tableName(table) !== oauthStateTable) return;
            const row = values as Record<string, any>;
            oauthStates.set(row.serverId, { id: oauthStates.size + 1, ...row });
        },
        update(table, values) {
            const name = tableName(table);
            if (name === oauthStateTable) {
                const patch = values as Record<string, any>;
                const serverId = Array.from(oauthStates.keys())[0];
                if (serverId !== undefined) {
                    oauthStates.set(serverId, { ...oauthStates.get(serverId), ...patch });
                }
                return;
            }
            if (name === serverTable) {
                serverUpdates.push(values as Record<string, any>);
            }
        },
        delete(table) {
            if (tableName(table) === oauthStateTable) {
                oauthStates.clear();
            }
        },
    };

    return { oauthStates, serverUpdates };
}

function makeServer() {
    return {
        id: 42,
        name: 'oauth-server',
        description: null,
        transportType: 'http',
        path: 'https://mcp.example.com/mcp',
        apiKey: null,
        authType: 'oauth',
        oauthStatus: 'not_connected',
        oauthClientId: null,
        oauthClientSecret: null,
        oauthScopes: null,
        env: null,
        confirmationMode: 'always',
        enabled: true,
        lastConnectedAt: null,
        lastError: null,
        enabledTools: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    } as const;
}

describe('DbMcpOAuthProvider', () => {
    beforeEach(() => {
        installUnitDb();
    });

    afterEach(() => {
        globalThis.__pipaliUnitDb = undefined;
    });

    test('persists and reloads OAuth client state', async () => {
        const provider = new DbMcpOAuthProvider(makeServer(), { callbackOrigin: 'http://localhost:6464' });

        const state = await provider.state();
        await provider.saveCodeVerifier('pkce-verifier');
        await provider.saveClientInformation({
            client_id: 'client-1',
            client_secret: 'secret-1',
        });
        await provider.saveTokens({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            token_type: 'Bearer',
            scope: 'read write',
        });

        expect(await provider.codeVerifier()).toBe('pkce-verifier');
        expect(await provider.clientInformation()).toEqual({
            client_id: 'client-1',
            client_secret: 'secret-1',
        });
        expect(await provider.tokens()).toEqual({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            token_type: 'Bearer',
            scope: 'read write',
        });

        const saved = await getMcpOAuthState(42);
        expect(saved?.state).toBe(state);
        expect(saved?.scope).toBe('read write');
    });

    test('stores authorization URL metadata and marks server auth pending', async () => {
        const { serverUpdates } = installUnitDb();
        const provider = new DbMcpOAuthProvider(makeServer(), { callbackOrigin: 'http://localhost:6464' });
        const authorizationUrl = new URL('https://auth.example.com/authorize?client_id=client-1');

        await provider.redirectToAuthorization(authorizationUrl);

        const saved = await getMcpOAuthState(42);
        expect(saved?.authorizationServerUrl).toBe('https://auth.example.com/');
        expect(saved?.lastAuthorizationUrl).toBe(authorizationUrl.toString());
        expect(serverUpdates.at(-1)).toMatchObject({
            oauthStatus: 'auth_pending',
        });
    });

    test('stores and validates protected resource URLs', async () => {
        const provider = new DbMcpOAuthProvider(makeServer());

        await provider.validateResourceURL('https://mcp.example.com/mcp');
        expect((await getMcpOAuthState(42))?.resourceUrl).toBe('https://mcp.example.com/mcp');

        await provider.validateResourceURL('https://mcp.example.com/mcp', 'https://mcp.example.com/mcp');
        expect((await getMcpOAuthState(42))?.resourceUrl).toBe('https://mcp.example.com/mcp');

        await expect(provider.validateResourceURL('https://mcp.example.com/mcp', 'https://other.example.com/resource'))
            .rejects
            .toThrow('Protected resource');
    });

    test('invalidates only the requested credential scope', async () => {
        const provider = new DbMcpOAuthProvider(makeServer());
        await provider.state();
        await provider.saveCodeVerifier('pkce-verifier');
        await provider.saveClientInformation({ client_id: 'client-1' });
        await provider.saveTokens({ access_token: 'access-1', token_type: 'Bearer', scope: 'read' });
        await provider.validateResourceURL('https://mcp.example.com/mcp');
        await saveMcpOAuthResourceMetadataUrl(42, 'https://mcp.example.com/.well-known/oauth-protected-resource/list_items');

        await clearMcpOAuthState(42, 'tokens');
        let saved = await getMcpOAuthState(42);
        expect(saved?.tokens).toBeNull();
        expect(saved?.clientInformation).toEqual({ client_id: 'client-1' });
        expect(saved?.codeVerifier).toBe('pkce-verifier');

        await clearMcpOAuthState(42, 'verifier');
        saved = await getMcpOAuthState(42);
        expect(saved?.state).toBeNull();
        expect(saved?.codeVerifier).toBeNull();
        expect(saved?.clientInformation).toEqual({ client_id: 'client-1' });

        await clearMcpOAuthState(42, 'client');
        saved = await getMcpOAuthState(42);
        expect(saved?.clientInformation).toBeNull();
        expect(saved?.resourceMetadataUrl).toBeNull();
        expect(saved?.resourceUrl).toBeNull();

        await clearMcpOAuthState(42);
        expect(await getMcpOAuthState(42)).toBeUndefined();
    });
});
