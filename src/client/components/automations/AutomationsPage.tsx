// Main automations page component

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Plus } from 'lucide-react';
import type { AutomationInfo, AutomationPendingConfirmation } from '../../types/automations';
import { AutomationCard } from './AutomationCard';
import { AutomationsEmpty } from './AutomationsEmpty';
import { CreateAutomationModal } from './CreateAutomationModal';
import { AutomationDetailModal } from './AutomationDetailModal';
import { apiFetch } from '../../utils/api';

interface AutomationsPageProps {
    pendingConfirmations: AutomationPendingConfirmation[];
    onConfirmationRespond: (confirmationId: string, optionId: string, guidance?: string) => void;
    onConfirmationDismiss: (confirmationId: string) => void;
    onViewConversation: (conversationId: string) => void;
    onAutomationChanged?: () => void;
}

export function AutomationsPage({
    pendingConfirmations,
    onConfirmationRespond,
    onConfirmationDismiss,
    onViewConversation,
    onAutomationChanged,
}: AutomationsPageProps) {
    const { t } = useTranslation();
    const [automations, setAutomations] = useState<AutomationInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedAutomation, setSelectedAutomation] = useState<AutomationInfo | null>(null);
    const [togglingAutomationIds, setTogglingAutomationIds] = useState<Set<string>>(() => new Set());
    const [statusError, setStatusError] = useState<string | null>(null);

    useEffect(() => {
        fetchAutomations();
    }, []);

    const fetchAutomations = async () => {
        try {
            const res = await apiFetch('/api/automations');
            if (res.ok) {
                const data = await res.json();
                setAutomations(data.automations || []);
            }
        } catch (e) {
            console.error('Failed to fetch automations', e);
        } finally {
            setIsLoading(false);
        }
    };

    // Create a map of automationId -> pending confirmation for quick lookup
    const confirmationsByAutomation = new Map<string, AutomationPendingConfirmation>();
    for (const confirmation of pendingConfirmations) {
        confirmationsByAutomation.set(confirmation.automationId, confirmation);
    }

    const handleRefresh = async () => {
        setIsRefreshing(true);
        setStatusError(null);
        try {
            await fetchAutomations();
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleAutomationCreated = () => {
        setShowCreateModal(false);
        handleRefresh();
    };

    const handleAutomationUpdated = () => {
        setSelectedAutomation(null);
        handleRefresh();
        onAutomationChanged?.();
    };

    const handleAutomationDeleted = () => {
        setSelectedAutomation(null);
        handleRefresh();
        onAutomationChanged?.();
    };

    const handleToggleAutomationStatus = async (automation: AutomationInfo, status: 'active' | 'paused') => {
        const previousStatus = automation.status;
        setStatusError(null);
        setTogglingAutomationIds((current) => new Set(current).add(automation.id));
        setAutomations((current) => current.map((item) =>
            item.id === automation.id ? { ...item, status } : item
        ));

        try {
            const endpoint = status === 'paused'
                ? `/api/automations/${automation.id}/pause`
                : `/api/automations/${automation.id}/resume`;

            const res = await apiFetch(endpoint, { method: 'POST' });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(typeof data?.error === 'string' ? data.error : t('automations.failedToUpdateStatus'));
            }

            await fetchAutomations();
            onAutomationChanged?.();
        } catch (e) {
            console.error('Failed to update automation status', e);
            setStatusError(e instanceof Error ? e.message : t('automations.failedToUpdateStatus'));
            setAutomations((current) => current.map((item) =>
                item.id === automation.id ? { ...item, status: previousStatus } : item
            ));
        } finally {
            setTogglingAutomationIds((current) => {
                const next = new Set(current);
                next.delete(automation.id);
                return next;
            });
        }
    };

    if (isLoading) {
        return (
            <main className="main-content">
                <div className="messages-container">
                    <div className="automations-gallery">
                        <div className="automations-loading">{t('automations.loading')}</div>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="main-content">
            <div className="messages-container">
                <div className="automations-gallery">
                    <div className="automations-header">
                        <div className="automations-header-left">
                            <h2>{t('automations.title')}</h2>
                            <span className="automations-count">{automations.length}</span>
                        </div>
                        <div className="automations-header-actions">
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="automations-create-btn"
                            >
                                <Plus size={16} />
                                <span>{t('common.create')}</span>
                            </button>
                            <button
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                className="automations-reload-btn"
                                title={t('automations.refreshTooltip')}
                            >
                                <RefreshCw size={16} className={isRefreshing ? 'spinning' : ''} />
                            </button>
                        </div>
                    </div>

                    {statusError && <div className="automations-status-error form-error">{statusError}</div>}

                    {automations.length === 0 ? (
                        <AutomationsEmpty />
                    ) : (
                        <div className="automations-cards">
                            {automations.map((automation) => (
                                <AutomationCard
                                    key={automation.id}
                                    automation={automation}
                                    pendingConfirmation={confirmationsByAutomation.get(automation.id)}
                                    onClick={() => setSelectedAutomation(automation)}
                                    onToggleStatus={(status) => handleToggleAutomationStatus(automation, status)}
                                    isToggling={togglingAutomationIds.has(automation.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {showCreateModal && (
                <CreateAutomationModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={handleAutomationCreated}
                />
            )}

            {selectedAutomation && (
                <AutomationDetailModal
                    automation={selectedAutomation}
                    pendingConfirmation={confirmationsByAutomation.get(selectedAutomation.id)}
                    onClose={() => setSelectedAutomation(null)}
                    onUpdated={handleAutomationUpdated}
                    onDeleted={handleAutomationDeleted}
                    onConfirmationRespond={onConfirmationRespond}
                    onViewConversation={(convId) => {
                        setSelectedAutomation(null);
                        onViewConversation(convId);
                    }}
                />
            )}
        </main>
    );
}
