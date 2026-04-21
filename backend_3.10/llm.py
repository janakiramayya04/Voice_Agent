import ollama


async def generate_response_stream(prompt: str):
    """
    Stream tokens from Ollama's gemma2:2b model.
    Fully async to allow task cancellation (voice interruptions).
    """
    client = ollama.AsyncClient()
    response = await client.generate(
        model="gemma2:2b",
        prompt=prompt,
        stream=True
    )
    
    async for chunk in response:
        token = chunk.get("response", "")
        if token:
            yield token