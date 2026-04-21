from gtts import gTTS
import tempfile

def text_to_speech(text: str):
    tts = gTTS(text=text, lang='en')

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as f:
        tts.save(f.name)
        return f.name