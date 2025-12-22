import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GeminiLiveSession, AudioCapture, VideoCapture } from '../../services/geminiLive';
import './LiveChat.css';

export default function LiveChat() {
  const navigate = useNavigate();

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  // Media state
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  // Transcript
  const [messages, setMessages] = useState([]);
  const [currentResponse, setCurrentResponse] = useState('');

  // Warning modal state
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [hasSeenWarning, setHasSeenWarning] = useState(() => {
    return localStorage.getItem('liveChat_hasSeenWarning') === 'true';
  });

  // Refs
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const audioCapRef = useRef(null);
  const videoCapRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse]);

  // Handle warning modal confirmation
  const handleWarningConfirm = () => {
    setHasSeenWarning(true);
    localStorage.setItem('liveChat_hasSeenWarning', 'true');
    setShowWarningModal(false);
    startCall();
  };

  // Handle skip warning
  const handleWarningSkip = () => {
    setShowWarningModal(false);
  };

  // Try to start call (check warning first)
  const tryStartCall = () => {
    if (!hasSeenWarning) {
      setShowWarningModal(true);
    } else {
      startCall();
    }
  };

  // Request permissions first
  const requestPermissions = useCallback(async () => {
    try {
      // Request camera and microphone permissions
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      // Stop the test stream immediately
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('카메라와 마이크 권한을 허용해주세요');
      } else if (err.name === 'NotFoundError') {
        setError('카메라 또는 마이크를 찾을 수 없습니다');
      } else {
        setError('미디어 장치 접근에 실패했습니다');
      }
      return false;
    }
  }, []);

  // Start call
  const startCall = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    // Request permissions first
    const hasPermission = await requestPermissions();
    if (!hasPermission) {
      setIsConnecting(false);
      return;
    }

    try {
      // Create Gemini Live session
      const session = new GeminiLiveSession({
        onConnectionChange: (connected) => {
          setIsConnected(connected);
          if (!connected) {
            setIsConnecting(false);
          }
        },
        onAudioResponse: (isPlaying) => {
          setIsAiSpeaking(isPlaying);
        },
        onTextResponse: (text) => {
          setCurrentResponse(prev => prev + text);
        },
        onInterrupted: () => {
          // AI was interrupted, save partial response
          setCurrentResponse(prev => {
            if (prev.trim()) {
              setMessages(msgs => [...msgs, { role: 'assistant', text: prev }]);
            }
            return '';
          });
        },
        onError: () => {
          setError('연결 중 오류가 발생했습니다');
        },
      });

      sessionRef.current = session;

      // Connect to Gemini
      await session.connect();

      // Start video capture
      const videoCap = new VideoCapture(videoRef.current, (base64) => {
        session.sendVideoFrame(base64);
      });
      await videoCap.start(1); // 1 FPS
      videoCapRef.current = videoCap;

      // Start audio capture
      const audioCap = new AudioCapture((base64) => {
        session.sendAudio(base64);
      });
      await audioCap.start();
      audioCapRef.current = audioCap;

      setIsConnecting(false);

      // Send initial greeting prompt
      setTimeout(() => {
        session.sendText("Hi! I just joined the video call. Please greet me naturally and start a casual conversation about what you see or just introduce yourself.");
      }, 1000);

    } catch (err) {
      if (err.message?.includes('not found') || err.message?.includes('not supported')) {
        setError('Gemini Live API를 사용할 수 없습니다. API 키를 확인하거나 나중에 다시 시도해주세요.');
      } else {
        setError(err.message || '통화 시작에 실패했습니다');
      }
      setIsConnecting(false);
    }
  }, [requestPermissions]);

  // End call
  const endCall = useCallback(() => {
    // Save final response
    if (currentResponse.trim()) {
      setMessages(msgs => [...msgs, { role: 'assistant', text: currentResponse }]);
      setCurrentResponse('');
    }

    // Stop captures
    audioCapRef.current?.stop();
    videoCapRef.current?.stop();

    // Disconnect session
    sessionRef.current?.disconnect();

    setIsConnected(false);
    setIsAiSpeaking(false);
  }, [currentResponse]);

  // Toggle microphone
  const toggleMic = useCallback(() => {
    if (audioCapRef.current) {
      if (isMicOn) {
        audioCapRef.current.stop();
      } else {
        audioCapRef.current.start();
      }
    }
    setIsMicOn(!isMicOn);
  }, [isMicOn]);

  // Toggle camera
  const toggleCamera = useCallback(() => {
    if (videoCapRef.current) {
      if (isCameraOn) {
        videoCapRef.current.stop();
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      } else {
        videoCapRef.current.start(1);
      }
    }
    setIsCameraOn(!isCameraOn);
  }, [isCameraOn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioCapRef.current?.stop();
      videoCapRef.current?.stop();
      sessionRef.current?.disconnect();
    };
  }, []);

  // Go back
  const handleBack = () => {
    endCall();
    navigate(-1);
  };

  return (
    <div className="live-chat-container">
      {/* Header */}
      <header className="chat-header live-chat-page-header">
        <button className="back-button" onClick={handleBack}>Back</button>
        <h1>
          {isConnected ? (
            <span className="call-status-inline">
              <span className="status-dot connected" />
              통화 중
            </span>
          ) : isConnecting ? (
            <span className="call-status-inline">
              <span className="status-dot connecting" />
              연결 중...
            </span>
          ) : (
            'AI 화상통화'
          )}
        </h1>
        <div style={{ width: 40 }} />
      </header>

      {/* Main video area */}
      <div className="video-area">
        {/* AI avatar / visualization */}
        <div className={`ai-avatar ${isAiSpeaking ? 'speaking' : ''}`}>
          <div className="avatar-circle">
            <div className="avatar-inner">
              {isAiSpeaking ? (
                <div className="sound-wave">
                  <span /><span /><span /><span /><span />
                </div>
              ) : (
                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
              )}
            </div>
          </div>
          <span className="avatar-name">English Tutor</span>
        </div>

        {/* User video (small) */}
        <div className={`user-video ${!isCameraOn ? 'camera-off' : ''}`}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
          />
          {!isCameraOn && (
            <div className="camera-off-overlay">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Transcript area */}
      <div className="transcript-area">
        <div className="transcript-scroll">
          {messages.map((msg, i) => (
            <div key={i} className={`transcript-message ${msg.role}`}>
              {msg.text}
            </div>
          ))}
          {currentResponse && (
            <div className="transcript-message assistant current">
              {currentResponse}
              <span className="typing-cursor" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="error-toast">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Controls */}
      <div className="call-controls">
        {!isConnected && !isConnecting ? (
          <button className="start-call-btn" onClick={tryStartCall}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
            </svg>
            <span>통화 시작</span>
          </button>
        ) : (
          <>
            <button
              className={`control-btn ${!isMicOn ? 'off' : ''}`}
              onClick={toggleMic}
              disabled={isConnecting}
            >
              {isMicOn ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V20c0 .55.45 1 1 1s1-.45 1-1v-2.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                </svg>
              )}
            </button>

            <button
              className={`control-btn ${!isCameraOn ? 'off' : ''}`}
              onClick={toggleCamera}
              disabled={isConnecting}
            >
              {isCameraOn ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
                </svg>
              )}
            </button>

            <button className="end-call-btn" onClick={endCall}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Tips */}
      {!isConnected && !isConnecting && (
        <div className="tips-area">
          <h3>💡 사용 팁</h3>
          <ul>
            <li>마이크와 카메라 권한을 허용해주세요</li>
            <li>AI가 카메라로 보이는 것을 보고 대화합니다</li>
            <li>자연스럽게 영어로 대화해보세요</li>
            <li>말을 끊으면 AI도 즉시 멈춥니다</li>
          </ul>

        </div>
      )}

      {/* Warning Modal */}
      {showWarningModal && (
        <div className="warning-modal-overlay">
          <div className="warning-modal">
            <div className="warning-modal-icon">⚠️</div>
            <h2>주의사항</h2>
            <ul className="warning-list">
              <li>이 기능은 AI와 실시간 화상통화를 제공합니다</li>
              <li>카메라와 마이크 권한이 필요합니다</li>
              <li>영상은 AI 분석에만 사용되며 저장되지 않습니다</li>
              <li>안정적인 인터넷 연결이 필요합니다</li>
              <li>조용한 환경에서 사용하시면 더 좋습니다</li>
            </ul>
            <div className="warning-modal-buttons">
              <button className="warning-btn skip" onClick={handleWarningSkip}>
                Skip
              </button>
              <button className="warning-btn next" onClick={handleWarningConfirm}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
