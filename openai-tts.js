const axios = require('axios');

/**
 * Função para gerar áudio usando o OpenAI TTS API
 * @param {string} text - O texto a ser falado
 * @param {function} onAudioComplete - Callback para enviar o áudio completo via websocket
 */
async function handleOpenAITTS(text, onAudioComplete) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");

  try {
    console.log("🎤 Gerando áudio completo via OpenAI TTS (Voz: Nova)...");
    
    const response = await axios({
      method: 'post',
      url: 'https://api.openai.com/v1/audio/speech',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: 'tts-1', 
        voice: 'nova',  
        input: text,
        response_format: 'mp3'
      },
      responseType: 'arraybuffer' // Pegamos o arquivo inteiro
    });

    onAudioComplete(Buffer.from(response.data));
    return Promise.resolve();

  } catch (error) {
    if (error.response) {
      console.error("❌ Erro OpenAI TTS API:", error.response.data);
    }
    throw error;
  }
}

module.exports = { handleOpenAITTS };
