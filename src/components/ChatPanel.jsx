import { useState, useRef, useEffect, useCallback } from 'react';
import ChatLog from '../containers/chat-log/ChatLog';
import { speakText, stopSpeaking, preloadVoices } from '../utils/tts';
import { getSetting, SETTINGS_KEYS, LEVEL_OPTIONS } from '../services/settings';
import { useVoiceInput } from '../hooks';

/**
 * Shared ChatPanel component for Viewer and YouTubeViewer
 * Supports both text chat and conversational voice mode
 */
export default function ChatPanel({ chat, sourceTitle }) {
  const {
    messages,
    loading,
    streamingText,
    showPanel,
    setShowPanel,
    handleSend,
    handleClear,
    refreshHistory,
  } = chat;

  const [input, setInput] = useState('');
  const [conversationMode, setConversationMode] = useState(false);
  const [speechRate, setSpeechRate] = useState(() => {
    const saved = localStorage.getItem('chat_speech_rate');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [speaking, setSpeaking] = useState(false);
  const inputRef = useRef(null);
  const prevStreamingRef = useRef('');
  const conversationModeRef = useRef(false);
  const loadingRef = useRef(false);
  const speechRateRef = useRef(speechRate);
  const stopListeningRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { conversationModeRef.current = conversationMode; }, [conversationMode]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);

  // Auto-send callback for voice input - stop listening, force English
  const handleAutoSend = useCallback((text) => {
    if (text.trim() && !loadingRef.current) {
      stopListeningRef.current?.();
      handleSend(text, { languageOverride: 'English', conversationMode: true });
    }
  }, [handleSend]);

  // Voice input with auto-send
  const {
    isListening,
    transcript,
    interimText,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
  } = useVoiceInput({ onAutoSend: handleAutoSend });

  // Keep stopListening ref in sync
  useEffect(() => { stopListeningRef.current = stopListening; }, [stopListening]);

  const level = getSetting(SETTINGS_KEYS.ENGLISH_LEVEL, 'intermediate');
  const levelLabel = LEVEL_OPTIONS.find(o => o.value === level)?.label || level;

  // Preload TTS voices on mount
  useEffect(() => {
    preloadVoices();
  }, []);

  // Auto-resume listening after TTS finishes in conversation mode
  const resumeListeningAfterTts = useCallback(() => {
    setSpeaking(false);
    if (conversationModeRef.current) {
      // Small delay before resuming listening
      setTimeout(() => {
        if (conversationModeRef.current) {
          startListening();
        }
      }, 500);
    }
  }, [startListening]);

  // TTS for AI responses - auto-speak in conversation mode
  useEffect(() => {
    if (!conversationMode) return;

    // When streaming finishes (streamingText becomes empty and we have a new message)
    if (prevStreamingRef.current && !streamingText) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        speakText(lastMsg.message, {
          rate: speechRateRef.current,
          onStart: () => setSpeaking(true),
          onEnd: resumeListeningAfterTts,
        });
      }
    }
    prevStreamingRef.current = streamingText;
  }, [streamingText, messages, conversationMode, resumeListeningAfterTts]);

  // Start/stop conversation mode
  const toggleConversationMode = useCallback(() => {
    if (conversationMode) {
      // Stop everything
      stopListening();
      stopSpeaking();
      setSpeaking(false);
      setConversationMode(false);
    } else {
      // Start conversation mode - unlock audio with silent utterance (mobile Safari)
      const unlock = new SpeechSynthesisUtterance('');
      unlock.volume = 0;
      window.speechSynthesis?.speak(unlock);
      preloadVoices();
      setConversationMode(true);
      startListening();
    }
  }, [conversationMode, startListening, stopListening]);

  const handleSpeedChange = useCallback((rate) => {
    setSpeechRate(rate);
    localStorage.setItem('chat_speech_rate', rate.toString());
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim()) return;
    handleSend(input);
    setInput('');
    clearTranscript();
  }, [input, handleSend, clearTranscript]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleStopSpeaking = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
  }, []);

  const handleClose = useCallback(() => {
    setShowPanel(false);
    stopSpeaking();
    stopListening();
    setConversationMode(false);
    setSpeaking(false);
  }, [setShowPanel, stopListening]);

  // Display text: show interim voice text while listening
  const displayText = isListening ? (interimText || transcript || '') : '';

  const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5];

  return (
    <>
      {/* Floating chat button */}
      {!showPanel && (
        <button
          className="chat-float-btn"
          onClick={() => setShowPanel(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      )}

      {/* Chat panel overlay */}
      {showPanel && (
        <div className="chat-panel-overlay">
          <div className="chat-panel">
            {/* Header */}
            <div className="chat-panel-header">
              <div className="chat-panel-header-left">
                <span className="chat-level-badge">{levelLabel}</span>
                {sourceTitle && (
                  <span className="chat-source-title" title={sourceTitle}>
                    {sourceTitle.length > 20 ? sourceTitle.slice(0, 20) + '...' : sourceTitle}
                  </span>
                )}
              </div>
              <div className="chat-panel-header-right">
                {/* Speed control */}
                <select
                  className="chat-speed-select"
                  value={speechRate}
                  onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                >
                  {SPEED_OPTIONS.map(s => (
                    <option key={s} value={s}>{s}x</option>
                  ))}
                </select>

                {/* Clear chat */}
                <button
                  className="chat-header-btn"
                  onClick={handleClear}
                  title="Clear chat"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>

                {/* Close */}
                <button
                  className="chat-header-btn"
                  onClick={handleClose}
                  title="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Conversation mode status bar */}
            {conversationMode && (
              <div
                className={`chat-conversation-bar ${speaking ? 'speaking' : isListening ? 'listening' : loading ? 'thinking' : ''}`}
                onClick={speaking ? handleStopSpeaking : undefined}
              >
                {speaking
                  ? 'AI is speaking... (tap to stop)'
                  : isListening
                    ? (displayText || 'Listening...')
                    : loading
                      ? 'Thinking...'
                      : 'Ready'}
              </div>
            )}

            {/* Messages */}
            <div className="chat-panel-messages">
              <ChatLog
                messages={messages}
                streamingText={streamingText}
                onScrapToggle={refreshHistory}
              />
            </div>

            {/* Input area */}
            <div className="chat-panel-input">
              {/* Conversation mode toggle (big mic button) */}
              {voiceSupported && (
                <button
                  className={`chat-conversation-btn ${conversationMode ? 'active' : ''}`}
                  onClick={toggleConversationMode}
                  title={conversationMode ? 'Stop conversation' : 'Start conversation'}
                >
                  {conversationMode ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                  )}
                </button>
              )}

              <textarea
                ref={inputRef}
                className="chat-input-field"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={conversationMode ? 'Voice mode active...' : 'Ask about this content...'}
                rows={1}
                disabled={loading || conversationMode}
              />

              {/* Send button */}
              <button
                className="chat-send-btn"
                onClick={handleSubmit}
                disabled={!input.trim() || loading || conversationMode}
              >
                {loading ? (
                  <span className="chat-loading-dot">...</span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
