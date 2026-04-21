import asyncio
import tempfile
import edge_tts
import re

TTS_VOICE = "en-US-JennyNeural"


def clean_text_for_speech(text: str) -> str:
    """Clean text by removing markdown and emojis before TTS."""
    # Remove actions like *smiles*
    text = re.sub(r'\*[^*]+\*', '', text)
    # Remove remaining markdown characters
    text = re.sub(r'[*_~`]', '', text)
    # Filter out most emojis and odd symbols by keeping only words, spaces, and punctuation
    text = re.sub(r'[^\w\s\.,\?!:\'\"\-]', '', text)
    # Normalize whitespaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text


async def text_to_speech(text: str) -> str:
    """
    Generate speech from text using edge-tts (Microsoft Edge neural voices).
    Returns the path to the generated MP3 file.
    Much faster and higher quality than pyttsx3.
    """
    text = clean_text_for_speech(text)
    
    if not text:
        return ""

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as f:
        output_path = f.name

    communicate = edge_tts.Communicate(text, TTS_VOICE)
    await communicate.save(output_path)
    return output_path