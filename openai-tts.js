const axios = require('axios');

/**
 * Função para gerar áudio usando o OpenAI TTS API
 * @param {string} text - O texto a ser falado
 * @param {function} onAudioChunk - Callback para enviar os chunks de áudio via websocket
 */
async function handleOpenAITTS(text, onAudioChunk) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");

  try {
    console.log("🎤 Gerando áudio via OpenAI TTS (Voz: Nova)...");
    
    const response = await axios({
      method: 'post',
      url: 'https://api.openai.com/v1/audio/speech',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: 'tts-1', // tts-1 é mais rápido que tts-1-hd, ideal para tempo real
        voice: 'nova',  // Voz feminina, profissional e clara
        input: text,
        response_format: 'mp3'
      },
      responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        onAudioChunk(chunk);
      });

      response.data.on('end', () => {
        resolve();
      });

      response.data.on('error', (err) => {
        reject(err);
      });
    });

  } catch (error) {
    if (error.response) {
      console.error("❌ Erro OpenAI TTS API:", error.response.data);
    }
    throw error;
  }
}

module.exports = { handleOpenAITTS };
