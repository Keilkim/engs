/**
 * Gemini 2.0 Live API - 실시간 멀티모달 화상통화
 * WebSocket을 통한 실시간 음성/영상 스트리밍
 */

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

// Gemini Live API WebSocket URL
const LIVE_API_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_API_KEY}`;

export class GeminiLiveSession {
  constructor(options = {}) {
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.audioWorklet = null;
    this.isConnected = false;
    this.isPlaying = false;

    // Callbacks
    this.onAudioResponse = options.onAudioResponse || (() => {});
    this.onTextResponse = options.onTextResponse || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || (() => {});
    this.onConnectionChange = options.onConnectionChange || (() => {});
    this.onInterrupted = options.onInterrupted || (() => {});

    // Audio playback queue
    this.audioQueue = [];
    this.isProcessingQueue = false;

    // System instruction
    this.systemInstruction = options.systemInstruction || this.getDefaultSystemInstruction();
  }

  getDefaultSystemInstruction() {
    return `You are a friendly English conversation partner having a real-time video call.
- Speak naturally like a native English speaker talking to a friend
- Use casual, conversational language with natural fillers (um, well, you know)
- Keep responses SHORT - usually 1-3 sentences, like real conversation
- React naturally to what you see in the video
- If you see something interesting, comment on it naturally
- Ask follow-up questions to keep the conversation flowing
- Adjust your speaking pace to be clear but natural
- Be encouraging and supportive when helping with English
- If the user makes grammar mistakes, gently correct them in a natural way
- Use varied intonation and emphasis like a real person`;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(LIVE_API_URL);

        this.ws.onopen = () => {
          console.log('[GeminiLive] WebSocket connected');
          this.sendSetup();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onerror = (error) => {
          console.error('[GeminiLive] WebSocket error:', error);
          this.onError(error);
          reject(error);
        };

        this.ws.onclose = (event) => {
          console.log('[GeminiLive] WebSocket closed:', event.code, event.reason);
          this.isConnected = false;
          this.onConnectionChange(false);
        };

        // Setup success callback
        this.onSetupComplete = () => {
          this.isConnected = true;
          this.onConnectionChange(true);
          resolve();
        };

      } catch (err) {
        reject(err);
      }
    });
  }

  sendSetup() {
    const setupMessage = {
      setup: {
        model: 'models/gemini-2.0-flash-exp',
        generationConfig: {
          responseModalities: ['AUDIO', 'TEXT'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Aoede', // Natural female voice
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: this.systemInstruction }],
        },
      },
    };

    this.ws.send(JSON.stringify(setupMessage));
    console.log('[GeminiLive] Setup sent');
  }

  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);

      // Setup complete
      if (data.setupComplete) {
        console.log('[GeminiLive] Setup complete');
        this.onSetupComplete?.();
        return;
      }

      // Server content (audio/text response)
      if (data.serverContent) {
        const content = data.serverContent;

        // Handle model turn
        if (content.modelTurn) {
          const parts = content.modelTurn.parts || [];

          for (const part of parts) {
            // Text response
            if (part.text) {
              this.onTextResponse(part.text);
            }

            // Audio response
            if (part.inlineData) {
              const audioData = part.inlineData.data;
              const mimeType = part.inlineData.mimeType;
              this.queueAudio(audioData, mimeType);
            }
          }
        }

        // Turn complete
        if (content.turnComplete) {
          console.log('[GeminiLive] Turn complete');
        }

        // Interrupted (user started speaking)
        if (content.interrupted) {
          console.log('[GeminiLive] Interrupted by user');
          this.clearAudioQueue();
          this.onInterrupted();
        }
      }

      // Tool call (future use)
      if (data.toolCall) {
        console.log('[GeminiLive] Tool call:', data.toolCall);
      }

    } catch (err) {
      console.error('[GeminiLive] Failed to parse message:', err);
    }
  }

  // Audio playback queue management
  queueAudio(base64Data, mimeType) {
    this.audioQueue.push({ data: base64Data, mimeType });
    this.processAudioQueue();
  }

  clearAudioQueue() {
    this.audioQueue = [];
    this.isPlaying = false;
  }

  async processAudioQueue() {
    if (this.isProcessingQueue || this.audioQueue.length === 0) return;

    this.isProcessingQueue = true;

    while (this.audioQueue.length > 0) {
      const { data, mimeType } = this.audioQueue.shift();
      await this.playAudio(data, mimeType);
    }

    this.isProcessingQueue = false;
  }

  async playAudio(base64Data, mimeType) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000, // Gemini outputs 24kHz PCM
        });
      }

      // Decode base64
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // PCM 16-bit to Float32
      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768;
      }

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(1, floatData.length, 24000);
      audioBuffer.getChannelData(0).set(floatData);

      // Play
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      this.isPlaying = true;
      this.onAudioResponse(true);

      return new Promise((resolve) => {
        source.onended = () => {
          this.isPlaying = false;
          this.onAudioResponse(false);
          resolve();
        };
        source.start();
      });

    } catch (err) {
      console.error('[GeminiLive] Audio playback error:', err);
      this.isPlaying = false;
    }
  }

  // Send audio data (from microphone)
  sendAudio(base64Audio) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: 'audio/pcm;rate=16000',
          data: base64Audio,
        }],
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  // Send video frame
  sendVideoFrame(base64Image) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: 'image/jpeg',
          data: base64Image,
        }],
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  // Send text message
  sendText(text) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }],
        }],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    this.clearAudioQueue();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isConnected = false;
    this.onConnectionChange(false);
    console.log('[GeminiLive] Disconnected');
  }
}

/**
 * Audio capture from microphone
 * Captures PCM 16-bit at 16kHz for Gemini
 */
export class AudioCapture {
  constructor(onAudioData) {
    this.onAudioData = onAudioData;
    this.mediaStream = null;
    this.audioContext = null;
    this.workletNode = null;
    this.isCapturing = false;
  }

  async start() {
    try {
      // Get microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });

      // Load audio worklet for processing
      await this.audioContext.audioWorklet.addModule(
        URL.createObjectURL(new Blob([`
          class AudioProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.buffer = [];
              this.bufferSize = 2048; // ~128ms at 16kHz
            }

            process(inputs, outputs, parameters) {
              const input = inputs[0];
              if (input.length > 0) {
                const samples = input[0];
                this.buffer.push(...samples);

                // Send when buffer is full
                while (this.buffer.length >= this.bufferSize) {
                  const chunk = this.buffer.splice(0, this.bufferSize);

                  // Convert to Int16
                  const pcm16 = new Int16Array(chunk.length);
                  for (let i = 0; i < chunk.length; i++) {
                    pcm16[i] = Math.max(-32768, Math.min(32767, chunk[i] * 32768));
                  }

                  this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
                }
              }
              return true;
            }
          }

          registerProcessor('audio-processor', AudioProcessor);
        `], { type: 'application/javascript' }))
      );

      // Create nodes
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

      // Handle audio data
      this.workletNode.port.onmessage = (event) => {
        const pcmBuffer = event.data;
        const base64 = this.arrayBufferToBase64(pcmBuffer);
        this.onAudioData(base64);
      };

      // Connect
      source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      this.isCapturing = true;
      console.log('[AudioCapture] Started');

    } catch (err) {
      console.error('[AudioCapture] Failed to start:', err);
      throw err;
    }
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isCapturing = false;
    console.log('[AudioCapture] Stopped');
  }
}

/**
 * Video capture from camera
 * Captures frames at specified FPS and sends as JPEG
 */
export class VideoCapture {
  constructor(videoElement, onFrameData) {
    this.videoElement = videoElement;
    this.onFrameData = onFrameData;
    this.mediaStream = null;
    this.canvas = null;
    this.ctx = null;
    this.intervalId = null;
    this.isCapturing = false;
    this.fps = 1; // 1 FPS default (Gemini recommends 1-2 FPS)
  }

  async start(fps = 1) {
    try {
      this.fps = fps;

      // Get camera
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
      });

      // Attach to video element
      this.videoElement.srcObject = this.mediaStream;
      await this.videoElement.play();

      // Create canvas for frame capture
      this.canvas = document.createElement('canvas');
      this.canvas.width = 640;
      this.canvas.height = 480;
      this.ctx = this.canvas.getContext('2d');

      // Start frame capture
      this.intervalId = setInterval(() => {
        this.captureFrame();
      }, 1000 / this.fps);

      this.isCapturing = true;
      console.log('[VideoCapture] Started at', fps, 'FPS');

    } catch (err) {
      console.error('[VideoCapture] Failed to start:', err);
      throw err;
    }
  }

  captureFrame() {
    if (!this.ctx || !this.videoElement) return;

    // Draw video frame to canvas
    this.ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);

    // Convert to JPEG base64
    const dataUrl = this.canvas.toDataURL('image/jpeg', 0.7);
    const base64 = dataUrl.split(',')[1];

    this.onFrameData(base64);
  }

  setFps(fps) {
    this.fps = fps;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        this.captureFrame();
      }, 1000 / this.fps);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    this.isCapturing = false;
    console.log('[VideoCapture] Stopped');
  }
}
