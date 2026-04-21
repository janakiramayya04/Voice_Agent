import whisper
import tempfile
import subprocess

model = whisper.load_model("base")

def transcribe_audio(audio_bytes: bytes):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as f:
        f.write(audio_bytes)
        webm_path = f.name

    wav_path = webm_path.replace(".webm", ".wav")

    # 🔥 Convert to WAV (IMPORTANT FIX)
    subprocess.run([
        "ffmpeg", "-i", webm_path,
        "-ar", "16000",
        "-ac", "1",
        wav_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    result = model.transcribe(wav_path)
    return result["text"]