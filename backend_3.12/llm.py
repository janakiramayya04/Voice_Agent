import requests

OLLAMA_URL = "http://localhost:11434/api/generate"

def generate_response(prompt: str):
    response = requests.post(
        OLLAMA_URL,
        json={
            "model": "gemma2:2b",
            "prompt": prompt,
            "stream": False
        }
    )

    data = response.json()
    return data["response"]