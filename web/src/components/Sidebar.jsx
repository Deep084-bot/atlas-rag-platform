import { ConversationList } from './ConversationList.jsx';

export function Sidebar({ conversations, activeConversationId, isLoading, onSelect, onNew, onRename, onDelete }) {
  return (
    <aside className="flex w-72 flex-col border-r border-white/10 bg-slate-950/30">
      <div className="border-b border-white/10 p-4">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-full bg-atlas-teal px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
        >
          + New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
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
