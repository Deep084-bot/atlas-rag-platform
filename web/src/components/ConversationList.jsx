import { ConversationItem } from './ConversationItem.jsx';

export function ConversationList({ conversations, activeConversationId, isLoading, onSelect, onRename, onDelete }) {
  if (isLoading) {
    return <p className="px-3 text-sm text-slate-400">Loading conversations...;</p>;
  }

  if (!conversations.length) {
    return (
      <div className="flex items-center justify-center h-full px-3">
        <div className="text-center">
          <p className="text-sm text-slate-400">No conversations yet.</p>
          <p className="mt-1 text-xs text-slate-500">Click New Conversation to start chatting with your documents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {conversations.map((conversation) => (
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
  );
}
