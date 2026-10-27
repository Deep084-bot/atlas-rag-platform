import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  conversationPath,
  getConversationRouteAction,
  isConversationNotFound
} from '../../web/src/hooks/conversationRouting.js';

test('builds app and conversation paths', () => {
  assert.equal(conversationPath(''), '/app');
  assert.equal(conversationPath('  '), '/app');
  assert.equal(conversationPath('conversation-123'), '/app/conversations/conversation-123');
  assert.equal(conversationPath('id/with space'), '/app/conversations/id%2Fwith%20space');
});

test('restores a conversation from the route when it differs from active state', () => {
  assert.equal(
    getConversationRouteAction({
      routeConversationId: 'conversation-2',
      activeConversationId: 'conversation-1'
    }),
    'select'
  );
  assert.equal(
    getConversationRouteAction({ routeConversationId: 'conversation-1', activeConversationId: '' }),
    'select'
  );
});

test('does not reload a conversation already restored from the route', () => {
  assert.equal(
    getConversationRouteAction({
      routeConversationId: 'conversation-1',
      activeConversationId: 'conversation-1'
    }),
    'none'
  );
});

test('returns home when navigation leaves the conversation route', () => {
  assert.equal(
    getConversationRouteAction({
      routeConversationId: '',
      activeConversationId: 'conversation-1'
    }),
    'home'
  );
  assert.equal(
    getConversationRouteAction({ routeConversationId: '', activeConversationId: '' }),
    'none'
  );
});

test('identifies not-found conversation errors only', () => {
  assert.equal(isConversationNotFound({ status: 404 }), true);
  assert.equal(isConversationNotFound({ status: 403 }), false);
  assert.equal(isConversationNotFound(new Error('network')), false);
});
