# Voice AI Agent 🎙️🧠

A fully local, hands-free conversational AI agent built with a modern React frontend and a FastAPI backend. It features **Voice Activity Detection (VAD)** and **Continuous Interruption**, giving it a natural, ChatGPT-like voice mode experience.

## ✨ Features
- **Hands-Free Detection (VAD)**: Click Start once. The agent continuously monitors your microphone and automatically detects when you finish speaking using volume threshold metrics.
- **True Interruptions**: If the AI is mid-sentence and you speak loudly, the agent will instantly cancel its playback and background text generation, listen to your new command, and pivot seamlessly.
- **Fully Local Architecture**: Total privacy. STT and LLM processing happens entirely on your machine.
- **Asynchronous Audio Pipeline**: Tokens are generated iteratively, allowing text-to-speech to queue sentence-by-sentence. You start hearing the AI's response immediately instead of waiting for the entire generation.

## 🧰 Tech Stack
- **Frontend**: React + Vite
- **Backend Framework**: Python FastAPI + WebSockets
- **Speech-to-Text (STT)**: [OpenAI Whisper](https://github.com/openai/whisper) 📝
- **Brain (LLM)**: [Ollama](https://ollama.com/) running `gemma2:2b` 🤖
- **Text-to-Speech (TTS)**: [Edge-TTS](https://github.com/rany2/edge-tts) (Neural Microsoft Voices) 🔊
- **Audio Handling**: `ffmpeg`, Native Browser `MediaRecorder` API

---

## 🛠️ Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/en) installed.
- [Python 3.10+](https://www.python.org/downloads/) installed.
- [Ollama](https://ollama.com/) installed and running.
- [FFmpeg](https://ffmpeg.org/download.html) installed and added to your System PATH.

### 1. Start the LLM (Ollama)
Open a terminal and pull/run your model:
```bash
ollama run gemma2:2b
```
*(Leave this running in the background).*

### 2. Backend Setup
Navigate to the Python backend directory:
```bash
cd backend_3.10
```
Create a virtual environment and activate it:
```bash
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Mac/Linux:
source .venv/bin/activate
```
Install all Python dependencies (`fastapi`, `uvicorn`, `openai-whisper`, `ollama`, `edge-tts`, etc.):
*(See `requirements.txt` if available, or install manually)*
```bash
pip install -r requirements.txt
```
Run the FastAPI server:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Frontend Setup
Open a new terminal window and navigate to the frontend directory:
```bash
cd frontend/voice-agetn-frontend
```
Install Node modules:
```bash
npm install
```
Start the Vite development server:
```bash
npm run dev
```

---

## 🚀 Usage

1. Go to `http://localhost:5173` (or whatever port Vite opened).
2. Click the big **START** button. Grant microphone permissions if prompted.
3. Speak naturally. The system will watch the volume threshold string and flash "processing" when you stop.
4. If the agent is reading a long story and you want to change topics, simply talk over it! It'll instantly stop and listen to you.

## System Notes
- **GPU Acceleration:** STT uses Whisper. If you have an NVIDIA card with correctly installed CUDA packages, Whisper will leverage FP16 operations for incredibly fast transcriptions. Without it, you may see `FP16 is not supported on CPU` — the STT will still run accurately, just slightly slower.
- **Emoji Filtering:** The agent is smart enough to strip markdown formatting (`*smiles*`) and text emojis before passing them to the TTS engine, ensuring a natural robotic voice without spelled-out symbols.
