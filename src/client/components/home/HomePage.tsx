// Main home page component

import React from 'react';
import type { ActiveTask } from '../../types';
import { TaskCardGallery } from './TaskCardGallery';
import { EmptyHomeState } from './EmptyHomeState';

interface HomePageProps {
    activeTasks: ActiveTask[];
    onSelectTask: (conversationId: string) => void;
    onClearFinished: () => void;
    userFirstName?: string;
    hasInput?: boolean;
}

export function HomePage({ activeTasks, onSelectTask, onClearFinished, userFirstName, hasInput }: HomePageProps) {
    return (
        <main className="main-content">
            <div className="messages-container">
                {activeTasks.length === 0 ? (
                    <EmptyHomeState userFirstName={userFirstName} hasInput={hasInput} />
                ) : (
                    <TaskCardGallery
                        tasks={activeTasks}
                        onSelectTask={onSelectTask}
                        onClearFinished={onClearFinished}
                    />
                )}
            </div>
        </main>
    );
}
