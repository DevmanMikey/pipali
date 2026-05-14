import { Terminal, Globe, CheckCircle, XCircle, AlertCircle, Loader2, ChevronRight, ShieldCheck, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { McpServerInfo, McpConnectionStatus } from '../../types/mcp';

interface McpServerCardProps {
    server: McpServerInfo;
    onClick?: () => void;
    onToggleEnabled?: (enabled: boolean) => void;
    isToggling?: boolean;
}

function getStatusIcon(status: McpConnectionStatus | undefined, enabled: boolean, statusText?: string) {
    if (!enabled) {
        return <XCircle size={12} className="status-icon disabled" />;
    }

    if (statusText === 'auth_pending') {
        return <Loader2 size={12} className="status-icon connecting spinning" />;
    }
    if (statusText === 'auth_required') {
        return <AlertCircle size={12} className="status-icon error" />;
    }

    switch (status) {
        case 'connected':
            return <CheckCircle size={12} className="status-icon connected" />;
        case 'connecting':
            return <Loader2 size={12} className="status-icon connecting spinning" />;
        case 'error':
            return <AlertCircle size={12} className="status-icon error" />;
        default:
            return <XCircle size={12} className="status-icon disconnected" />;
    }
}

function getStatusText(status: McpConnectionStatus | undefined, enabled: boolean): string {
    if (!enabled) return 'disabled';
    return status ?? 'disconnected';
}

function getEffectiveStatusText(server: McpServerInfo): string {
    if (!server.enabled) return 'disabled';
    if (server.authType === 'oauth' && (server.oauthStatus === 'auth_pending' || server.oauthStatus === 'auth_required')) {
        return server.oauthStatus;
    }
    return getStatusText(server.connectionStatus, server.enabled);
}

const STATUS_KEYS: Record<string, string> = {
    disabled: 'mcpTools.statusDisabled',
    disconnected: 'mcpTools.statusDisconnected',
    connected: 'mcpTools.statusConnected',
    connecting: 'mcpTools.statusConnecting',
    error: 'mcpTools.statusError',
    auth_pending: 'mcpTools.statusAuthPending',
    auth_required: 'mcpTools.statusAuthRequired',
};

const CONFIRMATION_LABEL_KEYS: Record<McpServerInfo['confirmationMode'], string> = {
    always: 'mcpTools.confirmAlwaysBadge',
    unsafe_only: 'mcpTools.confirmUnsafeBadge',
    never: 'mcpTools.confirmNeverBadge',
};

const CONFIRMATION_TOOLTIP_KEYS: Record<McpServerInfo['confirmationMode'], string> = {
    always: 'mcpTools.confirmAllTooltip',
    unsafe_only: 'mcpTools.confirmUnsafeTooltip',
    never: 'mcpTools.confirmNeverTooltip',
};

export function McpServerCard({ server, onClick, onToggleEnabled, isToggling = false }: McpServerCardProps) {
    const { t } = useTranslation();
    const TransportIcon = server.transportType === 'stdio' ? Terminal : Globe;
    const AuthIcon = server.authType === 'oauth' ? ShieldCheck : server.authType === 'bearer' ? KeyRound : null;
    const status = server.connectionStatus;
    const statusText = getEffectiveStatusText(server);
    const statusLabel = t((STATUS_KEYS[statusText] ?? 'mcpTools.statusDisconnected') as any) as string;
    const confirmationLabel = t(CONFIRMATION_LABEL_KEYS[server.confirmationMode] as any) as string;
    const confirmationTooltip = t(CONFIRMATION_TOOLTIP_KEYS[server.confirmationMode] as any) as string;

    return (
        <div
            className={`mcp-server-card ${!server.enabled ? 'disabled' : ''}`}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick?.();
                }
            }}
        >
            <div className="mcp-server-card-title-row">
                <h3 className="mcp-server-card-title">{server.name}</h3>
                <label
                    className="mcp-card-toggle-switch"
                    title={server.enabled ? t('mcpTools.disableServer') : t('mcpTools.enableServer')}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <input
                        type="checkbox"
                        checked={server.enabled}
                        disabled={isToggling}
                        aria-label={server.enabled ? t('mcpTools.disableServer') : t('mcpTools.enableServer')}
                        onChange={(e) => onToggleEnabled?.(e.target.checked)}
                    />
                    <span className="mcp-card-toggle-slider"></span>
                </label>
            </div>

            <div className="mcp-server-card-meta-row">
                <div className={`mcp-server-status-badge ${statusText}`}>
                    {getStatusIcon(status, server.enabled, statusText)}
                    <span>{statusLabel}</span>
                </div>
                <div className="mcp-transport-badge">
                    <TransportIcon size={12} />
                    <span>{server.transportType}</span>
                </div>
                {AuthIcon && (
                    <div className="mcp-transport-badge">
                        <AuthIcon size={12} />
                        <span>{server.authType}</span>
                    </div>
                )}
            </div>

            {server.description && (
                <p className="mcp-server-card-description">{server.description}</p>
            )}

            <div className="mcp-server-card-path">
                <code>{server.path}</code>
            </div>

            {server.lastError && (
                <div className="mcp-server-card-error">
                    <AlertCircle size={12} />
                    <span>{server.lastError}</span>
                </div>
            )}

            <div className="mcp-server-card-footer">
                <div className="mcp-server-meta">
                    <span className={`mcp-server-confirmation-badge ${server.confirmationMode}`} title={confirmationTooltip}>
                        <span className="mcp-server-confirmation-prefix">{t('mcpTools.confirmBadgePrefix')}</span>
                        <span className="mcp-server-confirmation-value">{confirmationLabel}</span>
                    </span>
                </div>
                <ChevronRight size={14} className="mcp-server-chevron" />
            </div>
        </div>
    );
}
