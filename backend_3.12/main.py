from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from stt import transcribe_audio
from llm import generate_response
from tts import text_to_speech

import base64

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

audio_buffer = b""

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    print("Client connected")

    global audio_buffer

    try:
        while True:
            data = await ws.receive()

            if "bytes" in data:
                audio_buffer += data["bytes"]

            elif data.get("text") == "STOP":
                print("Processing audio...")

                # 🎤 STT
                text = transcribe_audio(audio_buffer)
                print("📝 User:", text)

                # 🤖 LLM
                reply = generate_response(text)
                print("🤖 AI:", reply)

                # 🔊 TTS
                audio_path = text_to_speech(reply)

                # send audio to frontend
                with open(audio_path, "rb") as f:
                    audio_bytes = f.read()

                encoded_audio = base64.b64encode(audio_bytes).decode()

                await ws.send_text(encoded_audio)

                audio_buffer = b""

    except Exception as e:
        print("Client disconnected", e)