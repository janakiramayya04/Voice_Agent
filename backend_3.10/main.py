import asyncio
import base64
import re
import os

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from stt import transcribe_audio
from llm import generate_response_stream
from tts import text_to_speech

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SENTENCE_END = re.compile(r'(?<=[.!?])\s+')


def split_into_sentences(text: str) -> list[str]:
    parts = SENTENCE_END.split(text.strip())
    return [p.strip() for p in parts if p.strip()]


async def process_audio_pipeline(ws: WebSocket, audio_buffer: bytes):
    """
    Runs the STT -> LLM -> TTS pipeline asynchronously.
    This can be cancelled if the user interrupts.
    """
    print("Processing audio...")

    # 1. Speech-to-Text
    try:
        text = await asyncio.to_thread(transcribe_audio, audio_buffer)
        print(f"📝 User: {text}")
    except Exception as e:
        print(f"[STT Error] {e}")
        return

    if not text.strip():
        await ws.send_json({"type": "status", "data": "empty"})
        return

    # 2. LLM (streaming) -> TTS (incremental)
    token_buffer = ""
    sentence_index = 0

    try:
        # Note: generate_response_stream is a sync generator,
        # but because it uses requests.iter_lines, it blocks.
        # We run its iteration in a way that respects cancellation.
        # To truly yield control while blocking, we can wrap the generator processing in a thread,
        # but an easier async-compatible approach is doing `to_thread` for the generator itself,
        # or checking for cancellation periodically.
        
        # Since standard `asyncio.sleep(0)` checks cancellation, we'll iterate with to_thread
        # Fully asynchronous iteration allows simultaneous INTERRUPT processing
        async for token in generate_response_stream(text):

            token_buffer += token
            sentences = split_into_sentences(token_buffer)

            if len(sentences) > 1:
                # All but the last fragment are complete sentences
                for sentence in sentences[:-1]:
                    sentence_index += 1
                    print(f"  [LLM→TTS] Sentence {sentence_index}: {sentence}")

                    audio_path = await text_to_speech(sentence)

                    if audio_path:
                        with open(audio_path, "rb") as f:
                            audio_bytes = f.read()

                        encoded = base64.b64encode(audio_bytes).decode()
                        await ws.send_json({
                            "type": "audio",
                            "data": encoded,
                            "format": "mp3",
                        })

                        try:
                            os.remove(audio_path)
                        except OSError:
                            pass

                token_buffer = sentences[-1]

        # Flush remaining text
        if token_buffer.strip():
            sentence_index += 1
            print(f"  [LLM→TTS] Sentence {sentence_index} (final): {token_buffer.strip()}")

            audio_path = await text_to_speech(token_buffer.strip())

            if audio_path:
                with open(audio_path, "rb") as f:
                    audio_bytes = f.read()

                encoded = base64.b64encode(audio_bytes).decode()
                await ws.send_json({
                    "type": "audio",
                    "data": encoded,
                    "format": "mp3",
                })

                try:
                    os.remove(audio_path)
                except OSError:
                    pass

        # Signal completion
        await ws.send_json({"type": "status", "data": "done"})
        print(f"🤖 AI response complete ({sentence_index} chunks sent)")

    except asyncio.CancelledError:
        print("⚠️ Pipeline cancelled due to voice interruption!")
        raise


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    print("Client connected")

    audio_buffer = b""
    pipeline_task = None

    try:
        while True:
            data = await ws.receive()

            if "text" in data and data["text"] == "INTERRUPT":
                # User spoke over the AI!
                print("🛑 User interrupted the agent!")
                if pipeline_task and not pipeline_task.done():
                    pipeline_task.cancel()
                pipeline_task = None
                audio_buffer = b""

            elif "bytes" in data:
                audio_buffer += data["bytes"]

            elif "text" in data and data["text"] == "STOP":
                # Start processing the gathered audio
                if pipeline_task and not pipeline_task.done():
                    pipeline_task.cancel()
                    
                gathered_audio = audio_buffer
                audio_buffer = b""
                
                pipeline_task = asyncio.create_task(
                    process_audio_pipeline(ws, gathered_audio)
                )

    except Exception as e:
        print("Client disconnected", e)