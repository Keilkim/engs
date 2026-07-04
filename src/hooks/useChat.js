import { useState, useEffect, useCallback, useRef } from 'react';
import { chatStream } from '../services/ai/chat';
import { saveChatMessage, getChatLogs, clearChatLogs } from '../services/chat';

/**
 * Shared chat hook for Viewer and YouTubeViewer
 * @param {Object} options
 * @param {string} options.sourceId - Source ID for chat history persistence
 * @param {string} options.sourceContext - OCR text or caption text as context
 * @param {string} options.topicTitle - Source title for topic restriction
 */
export function useChat({ sourceId, sourceContext = '', topicTitle = '' }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const historyLoadedRef = useRef(false);

  // Load chat history when panel opens
  useEffect(() => {
    if (showPanel && sourceId && !historyLoadedRef.current) {
      historyLoadedRef.current = true;
      loadChatHistory();
    }
  }, [showPanel, sourceId]);

  async function loadChatHistory() {
    try {
      const logs = await getChatLogs(sourceId);
      if (logs?.length > 0) {
        setMessages(logs);
      }
    } catch {
      // ignore
    }
  }

  const handleSend = useCallback(async (text, { languageOverride, conversationMode } = {}) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMessage = {
      tempId: Date.now(),
      role: 'user',
      message: trimmed,
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);
    setStreamingText('');

    // Save the user message in the background. A save failure must NOT block the
    // (paid) AI call — keep the optimistic message on screen either way.
    saveChatMessage(trimmed, 'user', sourceId)
      .then(savedUser => {
        if (savedUser) {
          setMessages(prev => prev.map(m => m.tempId === userMessage.tempId ? savedUser : m));
        }
      })
      .catch(() => { /* keep optimistic user message */ });

    let fullText = '';
    try {
      // Build context with topic restriction
      let context = sourceContext;
      if (topicTitle) {
        const topicInstruction = `[IMPORTANT TOPIC RESTRICTION]\nYou must ONLY discuss topics related to: "${topicTitle}"\nIf the user asks about unrelated topics, gently guide them back to the material.`;
        context = topicInstruction + (context ? '\n\n' + context : '');
      }

      // History already includes the current user message as the last turn.
      const currentMessages = [...messages, userMessage];

      // Stream AI response
      fullText = await chatStream(
        trimmed,
        context,
        currentMessages,
        (_chunk, full) => setStreamingText(full),
        { languageOverride, conversationMode }
      );
    } catch {
      setStreamingText('');
      setMessages(prev => [...prev, {
        tempId: Date.now(),
        role: 'assistant',
        message: 'Sorry, an error occurred. Please try again.',
      }]);
      setLoading(false);
      return;
    }

    // AI answered. Persist it, but if saving fails, DON'T discard the answer —
    // show it with a temp id and retry the save in the background.
    const aiTempId = Date.now() + 1;
    try {
      const savedAi = await saveChatMessage(fullText, 'assistant', sourceId);
      // Clear streaming + append in the same tick so the TTS effect can detect
      // the streaming→message transition.
      setStreamingText('');
      setMessages(prev => [...prev, savedAi]);
    } catch {
      setStreamingText('');
      setMessages(prev => [...prev, { tempId: aiTempId, role: 'assistant', message: fullText }]);
      // Background retry of the save only (answer already visible to the user).
      saveChatMessage(fullText, 'assistant', sourceId)
        .then(savedAi => {
          if (savedAi) {
            setMessages(prev => prev.map(m => m.tempId === aiTempId ? savedAi : m));
          }
        })
        .catch(() => { /* leave temp message; user still has the answer */ });
    } finally {
      setLoading(false);
    }
  }, [loading, messages, sourceId, sourceContext, topicTitle]);

  const handleClear = useCallback(async () => {
    try {
      await clearChatLogs(sourceId);
      setMessages([]);
    } catch {
      // ignore
    }
  }, [sourceId]);

  const refreshHistory = useCallback(() => {
    loadChatHistory();
  }, [sourceId]);

  return {
    messages,
    loading,
    streamingText,
    showPanel,
    setShowPanel,
    handleSend,
    handleClear,
    refreshHistory,
  };
}
