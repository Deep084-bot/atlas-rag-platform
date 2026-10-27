export const APP_HOME_PATH = '/app';

export function conversationPath(conversationId) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : '';

  if (!id) {
    return APP_HOME_PATH;
  }

  return `${APP_HOME_PATH}/conversations/${encodeURIComponent(id)}`;
}

export function getConversationRouteAction({ routeConversationId, activeConversationId }) {
  const routeId = typeof routeConversationId === 'string' ? routeConversationId.trim() : '';
  const activeId = typeof activeConversationId === 'string' ? activeConversationId.trim() : '';

  if (routeId && routeId !== activeId) {
    return 'select';
  }

  if (!routeId && activeId) {
    return 'home';
  }

  return 'none';
}

export function isConversationNotFound(error) {
  return error?.status === 404;
}
