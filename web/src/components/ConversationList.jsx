import { ConversationItem } from './ConversationItem.jsx';

export function ConversationList({ conversations, activeConversationId, isLoading, onSelect }) {
  if (isLoading) {
    return <p className="px-3 text-sm text-slate-400">Loading conversations&hellip;</p>;
  }

  if (!conversations.length) {
    return <p className="px-3 text-sm text-slate-400">No conversations yet. Start a new chat.</p>;
  }

  return (
    <div className="space-y-1">
      {conversations.map((conversation) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          isActive={conversation.id === activeConversationId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
