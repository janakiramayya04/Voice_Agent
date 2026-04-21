import React, { useState, useRef, useCallback, useEffect } from "react";

const SPEECH_THRESHOLD = 0.04;    // Adjust this (0.0 to 1.0) based on microphone sensitivity
const SILENCE_DURATION = 2000;    // ms of silence before treating speech as complete

const VoiceRecorder = () => {
  const [isActive, setIsActiveState] = useState(false);
  const isActiveRef = useRef(false);
  const setIsActive = (val) => {
    isActiveRef.current = val;
    setIsActiveState(val);
  };

  const [status, setStatusState] = useState("idle");
  const statusRef = useRef("idle");
  const setStatus = (val) => {
    statusRef.current = val;
    setStatusState(val);
  };

  const [volume, setVolume] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioChunks = useRef([]);
  const socketRef = useRef(null);

  // VAD refs
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const hadSpeechRef = useRef(false);
  const streamRef = useRef(null);

  // Audio queue refs
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentAudioElRef = useRef(null);

  // Forward declarations using refs for accurate state reading
  const startRecordingCycle = () => {
    if (!streamRef.current || !isActiveRef.current) return;

    // We only listen if NOT currently processing or speaking
    if (statusRef.current === "processing" || statusRef.current === "speaking") return;

    setStatus("listening");
    hadSpeechRef.current = false;
    audioChunks.current = [];

    const mediaRecorder = new MediaRecorder(streamRef.current);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const buffer = await event.data.arrayBuffer();
        socketRef.current.send(buffer);
      }
    };

    mediaRecorder.onstop = async () => {
      // Don't send STOP if we were manually canceled/interrupted and moved out of listening early
      if (statusRef.current !== "processing") return;

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send("STOP");
      }
    };

    mediaRecorder.start(500);
  };

  const interruptAgent = () => {
    // 1. Tell backend to stop current TTS generation
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send("INTERRUPT");
    }

    // 2. Stop any currently playing audio
    if (currentAudioElRef.current) {
      currentAudioElRef.current.pause();
      currentAudioElRef.current.removeAttribute('src'); // Stop downloading
      currentAudioElRef.current = null;
    }

    // 3. Clear audio queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;

    // 4. Force state to idle temporarily so we can restart cleanly
    setStatus("idle");

    // 5. Jump back to listening
    startRecordingCycle();
  };

  const playNextInQueue = () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      if (isActiveRef.current) {
        startRecordingCycle();
      } else {
        setStatus("idle");
      }
      return;
    }

    isPlayingRef.current = true;
    setStatus("speaking");

    const audioUrl = audioQueueRef.current.shift();
    const audio = new Audio(audioUrl);
    currentAudioElRef.current = audio;

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudioElRef.current = null;
      playNextInQueue();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudioElRef.current = null;
      playNextInQueue();
    };

    audio.play().catch(() => playNextInQueue());
  };

  const enqueueAudio = (base64Data, format) => {
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const mimeType = format === "mp3" ? "audio/mpeg" : "audio/wav";
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);

    audioQueueRef.current.push(url);

    if (!isPlayingRef.current) {
      playNextInQueue();
    }
  };

  const stopAgent = useCallback(() => {
    setIsActive(false);
    setStatus("idle");

    cancelAnimationFrame(animRef.current);
    clearTimeout(silenceTimerRef.current);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => { });
      audioCtxRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (currentAudioElRef.current) {
      currentAudioElRef.current.pause();
      currentAudioElRef.current = null;
    }

    audioQueueRef.current = [];
    isPlayingRef.current = false;
    hadSpeechRef.current = false;
    setVolume(0);
  }, []);

  const initWebSocket = () => {
    if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) {
      socketRef.current = new WebSocket("ws://localhost:8000/ws");
      socketRef.current.onopen = () => {
        console.log("✅ WebSocket connected");
      };

      socketRef.current.onerror = (err) => {
        console.error("❌ WebSocket error", err);
      };

      socketRef.current.onclose = () => {
        console.log("🔌 WebSocket closed");
      };
      socketRef.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "audio") {
            enqueueAudio(msg.data, msg.format || "mp3");
          } else if (msg.type === "status") {
            if (msg.data === "empty") {
              // Empty STT result -> back to listening
              if (isActiveRef.current) {
                setStatus("listening");
                startRecordingCycle();
              }
            }
          }
        } catch (e) {
          console.warn("Non-JSON message received:", e);
        }
      };
    }
  };

  const startAgent = async () => {
    setIsActive(true);
    initWebSocket();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      startRecordingCycle();
      startVADLoop(analyser);

    } catch (err) {
      console.error("Microphone access denied:", err);
      setIsActive(false);
    }
  };

  const startVADLoop = (analyser) => {
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!isActiveRef.current) return;

      analyser.getByteFrequencyData(data);
      const vol = data.reduce((a, b) => a + b, 0) / data.length / 255;
      setVolume(vol);

      const isLoud = vol > SPEECH_THRESHOLD;

      if (statusRef.current === "listening") {
        if (isLoud) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
          if (!hadSpeechRef.current) {
            hadSpeechRef.current = true;
          }
        } else if (hadSpeechRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = null;
            hadSpeechRef.current = false;

            // Move to processing
            setStatus("processing");
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
              mediaRecorderRef.current.stop();
            }
          }, SILENCE_DURATION);
        }
      }
      else if (statusRef.current === "processing" || statusRef.current === "speaking") {
        // Interruption logic!
        if (isLoud) {
          console.log("INTERRUPTION DETECTED!");
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
          hadSpeechRef.current = true; // immediately mark as having speech so we don't trigger instantly
          interruptAgent();
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };

    tick();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAgent();
    };
  }, [stopAgent]);


  // ── UI RENDERING ──────────────────────────────────────────────────────

  const statusLabels = {
    idle: "Ready",
    listening: "🎤 Listening to you…",
    processing: "🧠 Processing…",
    speaking: "🔊 AI Speaking…",
  };

  // Ensure VAD loop can see the current status using a dataset hack to bypass stale closures
  return (
    <div
      id="status-tracker"
      data-status={status}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: "#fff",
      }}
    >
      <h1 style={{
        fontSize: "2.5rem",
        background: "linear-gradient(90deg, #a78bfa, #60a5fa)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        marginBottom: "0.5rem",
      }}>
        🎙️ WebRTC Voice Agent
      </h1>

      <p style={{
        color: "#94a3b8",
        fontSize: "0.9rem",
        marginBottom: "2rem",
      }}>
        Continuous Hands-Free Mode Enabled
      </p>

      {/* Dynamic Status Pill */}
      <div style={{
        padding: "0.5rem 1.5rem",
        borderRadius: "999px",
        background: "rgba(255,255,255,0.08)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.1)",
        marginBottom: "2rem",
        fontSize: "0.95rem",
        color: status === "speaking" ? "#60a5fa" : status === "processing" ? "#fbbf24" : "#a78bfa",
        transition: "all 0.3s ease",
      }}>
        {statusLabels[status]}
      </div>

      {/* Main interaction button */}
      <button
        onClick={isActive ? stopAgent : startAgent}
        style={{
          width: "120px",
          height: "120px",
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          fontSize: "1.2rem",
          fontWeight: "bold",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.3s ease",
          background: isActive
            ? "linear-gradient(135deg, #ef4444, #dc2626)"
            : "linear-gradient(135deg, #10b981, #059669)",
          boxShadow: isActive
            ? "0 0 30px rgba(239,68,68,0.3)"
            : "0 0 40px rgba(16,185,129,0.3)",
          transform: (status === "listening" && volume > SPEECH_THRESHOLD) ? "scale(1.1)" : "scale(1)",
        }}
      >
        {isActive ? "STOP" : "START"}
      </button>

      {/* Visualizer ring when listening */}
      <div style={{
        marginTop: "20px",
        width: "150px",
        height: "4px",
        background: "rgba(255,255,255,0.1)",
        borderRadius: "2px",
        overflow: "hidden"
      }}>
        <div style={{
          height: "100%",
          background: "#60a5fa",
          width: `${Math.min(volume * 100 * 5, 100)}%`,  // Multiply volume to make it visible
          transition: "width 0.1s ease-out"
        }} />
      </div>

      <p style={{
        marginTop: "1.5rem",
        color: "#64748b",
        fontSize: "0.85rem",
        maxWidth: "400px",
        textAlign: "center",
        lineHeight: "1.5"
      }}>
        Click START to turn on the agent. It will automatically detect when you stop speaking, process your voice, reply, and go back to listening immediately.
      </p>
    </div>
  );
};

export default VoiceRecorder;