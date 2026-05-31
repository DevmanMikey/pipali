// Individual automation card for automations page gallery

import { useTranslation } from 'react-i18next';
import { ChevronRight, Clock, Calendar, AlertCircle } from 'lucide-react';
import type { AutomationInfo, AutomationPendingConfirmation } from '../../types/automations';
import { formatTime, formatDayOfWeek, formatDayOfMonth, formatNextRun } from './utils';
import type { TFunction } from 'i18next';

interface AutomationCardProps {
    automation: AutomationInfo;
    pendingConfirmation?: AutomationPendingConfirmation;
    onClick?: () => void;
    onToggleStatus?: (status: 'active' | 'paused') => void;
    isToggling?: boolean;
}

// Parse cron schedule to human-readable format
function formatSchedule(automation: AutomationInfo, t: TFunction): string {
    if (!automation.triggerType || !automation.triggerConfig) {
        return t('automations.manualOnly');
    }

    if (automation.triggerType !== 'cron') {
        return t('automations.fileWatchTrigger');
    }

    const config = automation.triggerConfig;
    if (config.type !== 'cron') return t('automations.unknownSchedule');

    const parts = config.schedule.split(' ');
    if (parts.length !== 5) return config.schedule;

    const minute = parts[0] ?? '0';
    const hour = parts[1] ?? '0';
    const dayOfMonth = parts[2] ?? '*';
    const dayOfWeek = parts[4] ?? '*';

    const hourNum = parseInt(hour, 10);
    const timeStr = formatTime(hourNum, minute, t);

    if (hour === '*') {
        return t('automations.hourlyAt', { minute: minute.padStart(2, '0') });
    }
    if (dayOfMonth === '*' && dayOfWeek === '*') {
        return t('automations.dailyAt', { time: timeStr });
    }
    if (dayOfMonth === '*' && dayOfWeek !== '*') {
        return t('automations.weeklyOn', { day: formatDayOfWeek(dayOfWeek, t), time: timeStr });
    }
    if (dayOfMonth !== '*') {
        return t('automations.monthlyOn', { day: formatDayOfMonth(parseInt(dayOfMonth, 10)), time: timeStr });
    }

    return config.schedule;
}

export function AutomationCard({
    automation,
    pendingConfirmation,
    onClick,
    onToggleStatus,
    isToggling = false,
}: AutomationCardProps) {
    const { t } = useTranslation();
    const isActive = automation.status === 'active';
    const isPaused = automation.status === 'paused';
    const hasConfirmation = !!pendingConfirmation;
    const hasSchedule = automation.triggerType && automation.triggerConfig;
    const schedule = formatSchedule(automation, t);
    const nextRun = hasSchedule ? formatNextRun(automation.nextScheduledAt, t) : null;

    // Determine card classes
    const cardClasses = [
        'automation-card',
        isActive ? 'active' : '',
        isPaused ? 'paused' : '',
        hasConfirmation ? 'awaiting-confirmation' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            className={cardClasses}
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
            <div className="automation-card-title-row">
                <h3 className="automation-card-title">{automation.name}</h3>
                <button
                    type="button"
                    className={`automation-toggle-btn ${isActive ? 'automation-toggle-on' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleStatus?.(isActive ? 'paused' : 'active');
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    disabled={isToggling}
                    title={isActive ? t('automations.pause') : t('automations.resume')}
                    aria-label={isActive ? t('automations.pause') : t('automations.resume')}
                    role="switch"
                    aria-checked={isActive}
                >
                    <span className="automation-toggle-track">
                        <span className="automation-toggle-thumb" />
                    </span>
                </button>
            </div>

            {hasConfirmation && (
                <div className="automation-status-badge awaiting-confirmation">
                    <AlertCircle size={10} />
                    {t('automations.needsApproval')}
                </div>
            )}

            {automation.description && (
                <p className="automation-card-description">{automation.description}</p>
            )}

            <p className="automation-card-prompt">{automation.prompt}</p>

            <div className="automation-card-footer">
                <div className="automation-schedule">
                    <Calendar size={12} />
                    <span>{schedule}</span>
                </div>
                {nextRun && isActive && !hasConfirmation && (
                    <div className="automation-next-run">
                        <Clock size={12} />
                        <span>{t('automations.next')} {nextRun}</span>
                    </div>
                )}
                <ChevronRight size={14} className="automation-chevron" />
            </div>
        </div>
    );
}
