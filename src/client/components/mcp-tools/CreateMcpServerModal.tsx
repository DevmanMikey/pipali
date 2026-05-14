import { useState, useEffect } from 'react';
import { X, Loader2, Terminal, Globe, Plus, Trash2, KeyRound, ShieldCheck, CircleSlash } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { McpTransportType, McpConfirmationMode, McpAuthType, CreateMcpServerInput } from '../../types/mcp';
import { apiFetch } from '../../utils/api';

interface CreateMcpServerModalProps {
    onClose: () => void;
    onCreated: () => void;
}

export function CreateMcpServerModal({ onClose, onCreated }: CreateMcpServerModalProps) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [transportType, setTransportType] = useState<McpTransportType>('stdio');
    const [authType, setAuthType] = useState<McpAuthType>('none');
    const [path, setPath] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [confirmationMode, setConfirmationMode] = useState<McpConfirmationMode>('always');
    const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);

    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSubmit = name.length > 0 && path.length > 0 && !isCreating;

    // Handle Escape key to close modal
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleAddEnvVar = () => {
        setEnvVars([...envVars, { key: '', value: '' }]);
    };

    const handleRemoveEnvVar = (index: number) => {
        setEnvVars(envVars.filter((_, i) => i !== index));
    };

    const handleEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
        const newEnvVars = [...envVars];
        const envVar = newEnvVars[index];
        if (envVar) {
            envVar[field] = value;
            setEnvVars(newEnvVars);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setIsCreating(true);
        setError(null);

        // Build env object from envVars array
        const env: Record<string, string> = {};
        for (const { key, value } of envVars) {
            if (key.trim()) {
                env[key.trim()] = value;
            }
        }

        const input: CreateMcpServerInput = {
            name: name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
            description: description || undefined,
            transportType,
            path,
            authType: transportType === 'http' ? authType : 'none',
            apiKey: transportType === 'http' && authType === 'bearer' ? apiKey || undefined : undefined,
            env: Object.keys(env).length > 0 ? env : undefined,
            confirmationMode,
        };

        try {
            const res = await apiFetch('/api/mcp/servers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (res.ok) {
                onCreated();
            } else {
                const data = await res.json();
                setError(data.error || t('mcpTools.failedToCreate'));
            }
        } catch (e) {
            setError(t('mcpTools.failedToCreate'));
        } finally {
            setIsCreating(false);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal mcp-server-modal">
                <div className="modal-header">
                    <h2>{t('mcpTools.addMcpServer')}</h2>
                    <button onClick={onClose} className="modal-close">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="mcp-server-form">
                    <div className="form-group">
                        <label htmlFor="server-name">{t('mcpTools.name')}</label>
                        <input
                            id="server-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                            placeholder={t('mcpTools.namePlaceholder')}
                            autoFocus
                        />
                        <span className="form-hint">{t('mcpTools.nameHint')}</span>
                    </div>

                    <div className="form-group">
                        <label htmlFor="server-description">{t('mcpTools.description')}</label>
                        <input
                            id="server-description"
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t('mcpTools.descriptionPlaceholder')}
                        />
                    </div>

                    <div className="form-group">
                        <label>{t('mcpTools.transportType')}</label>
                        <div className="transport-type-selector">
                            <button
                                type="button"
                                className={`transport-type-btn ${transportType === 'stdio' ? 'active' : ''}`}
                                onClick={() => {
                                    setTransportType('stdio');
                                    setAuthType('none');
                                }}
                            >
                                <Terminal size={16} />
                                <span>{t('mcpTools.stdio')}</span>
                                <span className="transport-hint">{t('mcpTools.stdioHint')}</span>
                            </button>
                            <button
                                type="button"
                                className={`transport-type-btn ${transportType === 'http' ? 'active' : ''}`}
                                onClick={() => setTransportType('http')}
                            >
                                <Globe size={16} />
                                <span>{t('mcpTools.http')}</span>
                                <span className="transport-hint">{t('mcpTools.httpHint')}</span>
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="server-path">
                            {transportType === 'stdio' ? t('mcpTools.commandLabel') : t('mcpTools.serverUrlLabel')} *
                        </label>
                        <input
                            id="server-path"
                            type="text"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            placeholder={
                                transportType === 'stdio'
                                    ? t('mcpTools.commandPlaceholder')
                                    : t('mcpTools.serverUrlPlaceholder')
                            }
                        />
                        <span className="form-hint">
                            {transportType === 'stdio'
                                ? t('mcpTools.commandHint')
                                : t('mcpTools.serverUrlHint')}
                        </span>
                    </div>

                    {transportType === 'http' && (
                        <>
                            <div className="form-group">
                                <label>{t('mcpTools.authType')}</label>
                                <div className="transport-type-selector compact">
                                    <button
                                        type="button"
                                        className={`transport-type-btn ${authType === 'none' ? 'active' : ''}`}
                                        onClick={() => setAuthType('none')}
                                    >
                                        <CircleSlash size={16} />
                                        <span>{t('mcpTools.authNone')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`transport-type-btn ${authType === 'bearer' ? 'active' : ''}`}
                                        onClick={() => setAuthType('bearer')}
                                    >
                                        <KeyRound size={16} />
                                        <span>{t('mcpTools.authBearer')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`transport-type-btn ${authType === 'oauth' ? 'active' : ''}`}
                                        onClick={() => setAuthType('oauth')}
                                    >
                                        <ShieldCheck size={16} />
                                        <span>{t('mcpTools.authOAuth')}</span>
                                    </button>
                                </div>
                                <span className="form-hint">
                                    {authType === 'oauth' ? t('mcpTools.authOAuthHint') : t('mcpTools.authTypeHint')}
                                </span>
                            </div>

                            {authType === 'bearer' && (
                                <div className="form-group">
                                    <label htmlFor="server-api-key">{t('mcpTools.apiKey')}</label>
                                    <input
                                        id="server-api-key"
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder={t('mcpTools.apiKeyPlaceholder')}
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {transportType === 'stdio' && (
                        <div className="form-group">
                            <label>{t('mcpTools.envVars')}</label>
                            <div className="env-vars-list">
                                {envVars.map((envVar, index) => (
                                    <div key={index} className="env-var-row">
                                        <input
                                            type="text"
                                            value={envVar.key}
                                            onChange={(e) => handleEnvVarChange(index, 'key', e.target.value)}
                                            placeholder={t('mcpTools.envKeyPlaceholder')}
                                            className="env-var-key"
                                        />
                                        <span className="env-var-separator">=</span>
                                        <input
                                            type="text"
                                            value={envVar.value}
                                            onChange={(e) => handleEnvVarChange(index, 'value', e.target.value)}
                                            placeholder={t('mcpTools.envValuePlaceholder')}
                                            className="env-var-value"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveEnvVar(index)}
                                            className="btn-icon-sm"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={handleAddEnvVar}
                                    className="btn-text add-env-var-btn"
                                >
                                    <Plus size={14} />
                                    <span>{t('mcpTools.addVariable')}</span>
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label htmlFor="confirmation-mode">{t('mcpTools.confirmationMode')}</label>
                        <select
                            id="confirmation-mode"
                            value={confirmationMode}
                            onChange={(e) => setConfirmationMode(e.target.value as McpConfirmationMode)}
                            className="form-select"
                        >
                            <option value="always">{t('mcpTools.confirmAlways')}</option>
                            <option value="unsafe_only">{t('mcpTools.confirmUnsafe')}</option>
                            <option value="never">{t('mcpTools.confirmNever')}</option>
                        </select>
                        <span className="form-hint">
                            {confirmationMode === 'always' && t('mcpTools.confirmAlwaysHint')}
                            {confirmationMode === 'unsafe_only' && t('mcpTools.confirmUnsafeHint')}
                            {confirmationMode === 'never' && t('mcpTools.confirmNeverHint')}
                        </span>
                    </div>

                    {error && <div className="form-error">{error}</div>}

                    <div className="modal-actions">
                        <button type="button" onClick={onClose} className="btn-secondary">
                            {t('common.cancel')}
                        </button>
                        <button type="submit" disabled={!canSubmit} className="btn-primary">
                            {isCreating ? (
                                <>
                                    <Loader2 size={16} className="spinning" />
                                    <span>{t('mcpTools.adding')}</span>
                                </>
                            ) : (
                                t('mcpTools.addServer')
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
