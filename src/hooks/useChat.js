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

  const handleSend = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const userMessage = {
      tempId: Date.now(),
      role: 'user',
      message: text.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);
    setStreamingText('');

    try {
      // Save user message
      const savedUser = await saveChatMessage(text.trim(), 'user', sourceId);
      setMessages(prev =>
        prev.map(m => m.tempId === userMessage.tempId ? savedUser : m)
      );

      // Build context with topic restriction
      let context = sourceContext;
      if (topicTitle) {
        const topicInstruction = `[IMPORTANT TOPIC RESTRICTION]\nYou must ONLY discuss topics related to: "${topicTitle}"\nIf the user asks about unrelated topics, gently guide them back to the material.`;
        context = topicInstruction + (context ? '\n\n' + context : '');
      }

      // Get current messages for history
      const currentMessages = [...messages, savedUser || userMessage];

      // Stream AI response
      const fullText = await chatStream(
        text.trim(),
        context,
        currentMessages,
        (_chunk, full) => setStreamingText(full)
      );

      setStreamingText('');

      // Save AI response
      const savedAi = await saveChatMessage(fullText, 'assistant', sourceId);
      setMessages(prev => [...prev, savedAi]);
    } catch {
      setStreamingText('');
      setMessages(prev => [...prev, {
        tempId: Date.now(),
        role: 'assistant',
        message: 'Sorry, an error occurred. Please try again.',
      }]);
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
