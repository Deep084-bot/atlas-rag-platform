import { useMemo } from 'react';
import { ConversationItem } from './ConversationItem.jsx';

function SkeletonLine({ width }) {
  return (
    <div className="animate-pulse rounded-lg bg-white/5" style={{ height: 36, width }} />
  );
}

function getSectionKey(date) {
  const now = new Date();
  const d = new Date(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  if (d >= today) return 'today';
  if (d >= yesterday) return 'yesterday';
  if (d >= lastWeek) return 'lastWeek';
  return 'older';
}

const SECTION_LABELS = {
  today: 'Today',
  yesterday: 'Yesterday',
  lastWeek: 'Last 7 Days',
  older: 'Older',
};

const SECTION_ORDER = ['today', 'yesterday', 'lastWeek', 'older'];

export function ConversationList({ conversations, activeConversationId, isLoading, onSelect, onRename, onDelete }) {
  const grouped = useMemo(() => {
    const groups = { today: [], yesterday: [], lastWeek: [], older: [] };
    for (const c of conversations) {
      const key = getSectionKey(c.updatedAt);
      groups[key].push(c);
    }
    return groups;
  }, [conversations]);

  if (isLoading) {
    return (
      <div className="space-y-2 px-3 py-4">
        <SkeletonLine width="100%" />
        <SkeletonLine width="85%" />
        <SkeletonLine width="92%" />
        <SkeletonLine width="78%" />
      </div>
    );
  }

  if (!conversations.length) {
    return (
      <div className="flex items-center justify-center px-3 py-12">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-sm text-slate-400">No conversations yet</p>
          <p className="mt-1 text-xs text-slate-500">Start a new conversation to chat with your documents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {SECTION_ORDER.map((key) => {
        const items = grouped[key];
        if (!items.length) return null;
        return (
          <div key={key}>
            <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500/60">
              {SECTION_LABELS[key]}
            </p>
            <div className="space-y-0.5">
              {items.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
