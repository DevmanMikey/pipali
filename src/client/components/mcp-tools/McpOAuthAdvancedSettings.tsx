import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface McpOAuthAdvancedSettingsProps {
    isOpen: boolean;
    onToggle: () => void;
    oauthClientId: string;
    onOAuthClientIdChange: (value: string) => void;
    oauthClientSecret: string;
    onOAuthClientSecretChange: (value: string) => void;
    oauthScopesText: string;
    onOAuthScopesTextChange: (value: string) => void;
}

export function isGoogleApisUrl(value: string): boolean {
    try {
        const { hostname } = new URL(value);
        return hostname === 'googleapis.com' || hostname.endsWith('.googleapis.com');
    } catch {
        return false;
    }
}

export function parseOAuthScopes(value: string): string[] {
    return [...new Set(value.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean))];
}

export function McpOAuthAdvancedSettings({
    isOpen,
    onToggle,
    oauthClientId,
    onOAuthClientIdChange,
    oauthClientSecret,
    onOAuthClientSecretChange,
    oauthScopesText,
    onOAuthScopesTextChange,
}: McpOAuthAdvancedSettingsProps) {
    const { t } = useTranslation();
    const Chevron = isOpen ? ChevronDown : ChevronRight;

    return (
        <div className="mcp-advanced-settings">
            <button type="button" className="mcp-advanced-toggle" onClick={onToggle}>
                <Chevron size={16} />
                <span>{t('mcpTools.oauthAdvancedSettings')}</span>
            </button>

            {isOpen && (
                <div className="mcp-advanced-content">
                    <div className="form-group">
                        <label htmlFor="mcp-oauth-client-id">{t('mcpTools.oauthClientId')}</label>
                        <input
                            id="mcp-oauth-client-id"
                            type="text"
                            value={oauthClientId}
                            onChange={(e) => onOAuthClientIdChange(e.target.value)}
                            placeholder={t('mcpTools.oauthClientIdPlaceholder')}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="mcp-oauth-client-secret">{t('mcpTools.oauthClientSecret')}</label>
                        <input
                            id="mcp-oauth-client-secret"
                            type="password"
                            value={oauthClientSecret}
                            onChange={(e) => onOAuthClientSecretChange(e.target.value)}
                            placeholder={t('mcpTools.oauthClientSecretPlaceholder')}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="mcp-oauth-scopes">{t('mcpTools.oauthScopes')}</label>
                        <textarea
                            id="mcp-oauth-scopes"
                            value={oauthScopesText}
                            onChange={(e) => onOAuthScopesTextChange(e.target.value)}
                            placeholder={t('mcpTools.oauthScopesPlaceholder')}
                            rows={4}
                        />
                        <span className="form-hint">{t('mcpTools.oauthScopesHint')}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
