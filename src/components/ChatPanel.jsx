import { useState, useRef, useEffect, useCallback } from 'react';
import ChatLog from '../containers/chat-log/ChatLog';
import { speakText, stopSpeaking, isSpeaking } from '../utils/tts';
import { getSetting, SETTINGS_KEYS, LEVEL_OPTIONS } from '../services/settings';

/**
 * Shared ChatPanel component for Viewer and YouTubeViewer
 * Bottom sheet style chat panel with text + voice input
 */
export default function ChatPanel({ chat, voice, sourceTitle }) {
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

  const {
    isListening,
    transcript,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
  } = voice;

  const [input, setInput] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [speechRate, setSpeechRate] = useState(() => {
    const saved = localStorage.getItem('chat_speech_rate');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [speaking, setSpeaking] = useState(false);
  const inputRef = useRef(null);
  const prevStreamingRef = useRef('');

  const level = getSetting(SETTINGS_KEYS.ENGLISH_LEVEL, 'intermediate');
  const levelLabel = LEVEL_OPTIONS.find(o => o.value === level)?.label || level;

  // Handle voice transcript → input
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  // TTS for AI responses
  useEffect(() => {
    if (!ttsEnabled) return;

    // When streaming finishes (streamingText becomes empty and we have a new message)
    if (prevStreamingRef.current && !streamingText) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        speakText(lastMsg.message, {
          rate: speechRate,
          onStart: () => setSpeaking(true),
          onEnd: () => setSpeaking(false),
        });
      }
    }
    prevStreamingRef.current = streamingText;
  }, [streamingText, messages, ttsEnabled, speechRate]);

  const handleSpeedChange = useCallback((rate) => {
    setSpeechRate(rate);
    localStorage.setItem('chat_speech_rate', rate.toString());
  }, []);

  const handleToggleTts = useCallback(() => {
    if (ttsEnabled) {
      stopSpeaking();
      setSpeaking(false);
    }
    setTtsEnabled(prev => !prev);
  }, [ttsEnabled]);

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

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleStopSpeaking = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
  }, []);

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
                {/* TTS toggle */}
                <button
                  className={`chat-header-btn ${ttsEnabled ? 'active' : ''}`}
                  onClick={handleToggleTts}
                  title={ttsEnabled ? 'Disable voice' : 'Enable voice'}
                >
                  {ttsEnabled ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <line x1="23" y1="9" x2="17" y2="15"/>
                      <line x1="17" y1="9" x2="23" y2="15"/>
                    </svg>
                  )}
                </button>

                {/* Speed control (only when TTS enabled) */}
                {ttsEnabled && (
                  <select
                    className="chat-speed-select"
                    value={speechRate}
                    onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                  >
                    {SPEED_OPTIONS.map(s => (
                      <option key={s} value={s}>{s}x</option>
                    ))}
                  </select>
                )}

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
                  onClick={() => { setShowPanel(false); stopSpeaking(); }}
                  title="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Speaking indicator */}
            {speaking && (
              <div className="chat-speaking-bar" onClick={handleStopSpeaking}>
                <span className="speaking-wave">~</span> Speaking... (tap to stop)
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
              <textarea
                ref={inputRef}
                className="chat-input-field"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? 'Listening...' : 'Ask about this content...'}
                rows={1}
                disabled={loading}
              />

              {/* Voice input button */}
              {voiceSupported && (
                <button
                  className={`chat-voice-btn ${isListening ? 'listening' : ''}`}
                  onClick={handleVoiceToggle}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>
              )}

              {/* Send button */}
              <button
                className="chat-send-btn"
                onClick={handleSubmit}
                disabled={!input.trim() || loading}
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
