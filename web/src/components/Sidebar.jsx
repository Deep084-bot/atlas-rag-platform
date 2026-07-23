import { ConversationList } from './ConversationList.jsx';

export function Sidebar({ conversations, activeConversationId, isLoading, onSelect, onNew, onRename, onDelete }) {
  return (
    <aside className="hidden w-72 flex-col border-r border-white/10 bg-slate-950/30 lg:flex">
      <div className="border-b border-white/10 p-4">
        <button
          type="button"
          onClick={onNew}
          className="group w-full rounded-full bg-atlas-teal px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-sm shadow-atlas-teal/20 transition-all hover:bg-atlas-teal/90 hover:shadow-atlas-teal/30 active:scale-[0.98]"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 transition group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New conversation
          </span>
        </button>
      </div>
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
        <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Conversations</span>
        <span className="ml-auto rounded-md border border-white/5 bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-500">
          {conversations.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversationId}
          isLoading={isLoading}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
    </aside>
  );
}
