import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import { chatStream } from '../services/ai/chat';
import { saveChatMessage, getChatLogs, clearChatLogs } from '../services/chat';
import { getSessionScopeSnapshot, subscribeSessionScope } from '../services/sessionScope';
import { createChatSession } from './chatSession';

/** Chat history and pending work belong to one source and one login session. */
export function useChat({ sourceId, sourceContext = '', topicTitle = '' }) {
  const [showPanel, setShowPanel] = useState(false);
  const scope = useSyncExternalStore(subscribeSessionScope, getSessionScopeSnapshot, getSessionScopeSnapshot);
  const session = useMemo(() => createChatSession({
    sourceId, sessionScope: scope, chatStream, saveChatMessage, getChatLogs, clearChatLogs,
  }), [sourceId, scope]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => () => session.cancel(), [session]);
  useEffect(() => {
    if (showPanel && sourceId && scope.userId) void session.loadHistory();
  }, [showPanel, sourceId, scope, session]);

  const handleSend = useCallback((text, options = {}) => session.send(text, {
    sourceContext, topicTitle, ...options,
  }), [session, sourceContext, topicTitle]);
  const refreshHistory = useCallback(() => session.loadHistory(true), [session]);

  return {
    ...state,
    showPanel,
    setShowPanel,
    handleSend,
    handleClear: session.clear,
    refreshHistory,
  };
}
