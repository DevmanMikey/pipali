// Gallery layout for task cards

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ActiveTask } from '../../types';
import { TaskCard } from './TaskCard';

interface TaskCardGalleryProps {
    tasks: ActiveTask[];
    onSelectTask: (conversationId: string) => void;
    onClearFinished: () => void;
}

export function TaskCardGallery({ tasks, onSelectTask, onClearFinished }: TaskCardGalleryProps) {
    const { t } = useTranslation();
    const hasFinished = tasks.some(task => task.status === 'completed' || task.status === 'stopped');
    return (
        <div className="task-gallery">
            <div className="task-gallery-header">
                <h2>{t('tasks.activeTasks')}</h2>
                <div className="task-gallery-header-actions">
                    {hasFinished && (
                        <button
                            type="button"
                            className="task-gallery-clear"
                            onClick={onClearFinished}
                        >
                            {t('tasks.clearFinished')}
                        </button>
                    )}
                    <span className="task-count">
                        {t('tasks.taskCount', { count: tasks.length })}
                    </span>
                </div>
            </div>
            <div className="task-cards">
                {tasks.map(task => (
                    <TaskCard
                        key={task.conversationId}
                        task={task}
                        onClick={() => onSelectTask(task.conversationId)}
                    />
                ))}
            </div>
        </div>
    );
}
