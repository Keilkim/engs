import { abortable } from '../utils/abort.js';

// Each source/account has its own store. Delayed promises retain only their old
// store and are cancelled when the hook changes source or unmounts.
export function createChatSession({ sourceId, sessionScope, chatStream, saveChatMessage, getChatLogs, clearChatLogs }) {
  let state = { messages: [], loading: false, streamingText: '' };
  let version = 0;
  let historyLoaded = false;
  let historyRequest = null;
  const requests = new Set();
  const listeners = new Set();
  const update = change => {
    state = { ...state, ...change };
    listeners.forEach(listener => listener());
  };

  function begin() {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, sessionScope.signal]);
    const startedAt = version;
    requests.add(controller);
    return {
      controller,
      options: { sessionScope, signal },
      current: () => startedAt === version && !signal.aborted,
      finish: () => requests.delete(controller),
    };
  }

  function cancel() {
    version += 1;
    requests.forEach(controller => controller.abort());
    requests.clear();
    if (historyRequest) historyLoaded = false;
    historyRequest = null;
    update({ loading: false, streamingText: '' });
  }

  async function loadHistory(force = false) {
    if ((!force && historyLoaded) || state.loading || sessionScope.signal.aborted) return;
    historyRequest?.controller.abort();
    const request = begin();
    historyRequest = request;
    historyLoaded = true;
    try {
      const logs = await abortable(getChatLogs(sourceId, 50, request.options), request.options.signal);
      if (request.current()) update({ messages: logs || [] });
    } catch {
      if (request.current()) historyLoaded = false;
    } finally {
      if (historyRequest === request) historyRequest = null;
      request.finish();
    }
  }

  async function send(text, { sourceContext = '', topicTitle = '', languageOverride, conversationMode } = {}) {
    const trimmed = text.trim();
    if (!trimmed || state.loading || sessionScope.signal.aborted || !sessionScope.userId) return;
    historyRequest?.controller.abort();
    historyRequest = null;
    historyLoaded = true;
    const request = begin();
    const userMessage = { tempId: crypto.randomUUID(), role: 'user', message: trimmed };
    const currentMessages = [...state.messages, userMessage];
    update({ messages: currentMessages, loading: true, streamingText: '' });

    const userSave = abortable(saveChatMessage(trimmed, 'user', sourceId, request.options), request.options.signal)
      .then(saved => {
        if (request.current() && saved) {
          update({ messages: state.messages.map(message => message.tempId === userMessage.tempId ? saved : message) });
        }
      }).catch(() => { /* retain the optimistic user message */ });

    try {
      let context = sourceContext;
      if (topicTitle) {
        const restriction = `[IMPORTANT TOPIC RESTRICTION]\nYou must ONLY discuss topics related to: "${topicTitle}"\nIf the user asks about unrelated topics, gently guide them back to the material.`;
        context = restriction + (context ? '\n\n' + context : '');
      }
      const fullText = await abortable(chatStream(trimmed, context, currentMessages,
        (_chunk, full) => { if (request.current()) update({ streamingText: full }); },
        { languageOverride, conversationMode, ...request.options }), request.options.signal);
      if (!request.current()) return;

      let answer = { tempId: crypto.randomUUID(), role: 'assistant', message: fullText };
      try {
        answer = await abortable(saveChatMessage(fullText, 'assistant', sourceId, request.options), request.options.signal) || answer;
      } catch {
        // Keep the answer locally. Blindly retrying a failed response can create
        // duplicate rows when the server committed before the connection failed.
      }
      if (request.current()) update({ messages: [...state.messages, answer], streamingText: '' });
    } catch {
      if (request.current()) {
        update({ streamingText: '', messages: [...state.messages, {
          tempId: crypto.randomUUID(), role: 'assistant', message: 'Sorry, an error occurred. Please try again.',
        }] });
      }
    } finally {
      if (request.current()) update({ loading: false });
      // A slow user-message save must still be abortable after the AI finishes.
      void userSave.finally(request.finish);
    }
  }

  async function clear() {
    cancel();
    if (sessionScope.signal.aborted || !sessionScope.userId) return;
    const request = begin();
    update({ loading: true });
    try {
      await abortable(clearChatLogs(sourceId, request.options), request.options.signal);
      if (request.current()) {
        historyLoaded = true;
        update({ messages: [] });
      }
    } catch { /* leave existing history visible when deletion fails */ }
    finally {
      if (request.current()) update({ loading: false });
      request.finish();
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadHistory,
    send,
    clear,
    cancel,
  };
}
