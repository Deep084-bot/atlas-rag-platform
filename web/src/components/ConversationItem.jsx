export function ConversationItem({ conversation, isActive, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
        isActive
          ? 'border border-atlas-teal/30 bg-atlas-teal/15 text-white'
          : 'border border-transparent text-slate-300 hover:bg-white/5'
      }`}
    >
      <p className="truncate">{conversation.title}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        {new Date(conversation.updatedAt).toLocaleDateString()}
      </p>
    </button>
  );
}
