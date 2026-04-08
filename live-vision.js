const OpenAI = require('openai');
const { handleElevenLabs } = require('./elevenlabs');
const WebSocket = require('ws');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function setupLiveVision(server) {
  const wssVision = new WebSocket.Server({ noServer: true });

  wssVision.on('connection', (clientWs, request) => {
    const id = Math.random().toString(36).substr(2, 6).toUpperCase();
    const urlStr = request ? request.url : '';
    const langMatch = urlStr.match(/lang=([^&]*)/);
    const targetLang = langMatch ? langMatch[1] : 'en';
    const targetLangName = targetLang === 'zh' ? 'Mandarim' : 'Inglês';

    console.log(`👁️ [VISION-OPENAI-${id}] Client connected. Target: ${targetLangName}`);

    clientWs.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.vision_input) {
          const { image, text = "O que você está vendo agora?" } = data.vision_input;
          
          console.log(`📸 [VISION-OPENAI-${id}] Analyzing image with GPT-4o-mini...`);
          
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Você é a LingoLoom, uma professora de idiomas paciente e inteligente.
Sua tarefa:
1. Identifique o objeto ou cenário na imagem.
2. Responda em PORTUGUÊS (Brasil) de forma amigável, explicando o que é.
3. Ensine como dizer o nome desse objeto ou uma frase útil relacionada em ${targetLangName}.
4. Forneça a tradução exata e a pronúncia fonética (ajudando um brasileiro a ler).

Responda SEMPRE no seguinte formato JSON puro:
{
  "resposta_pt": "Sua explicação amigável em português aqui.",
  "termo_target": "O nome do objeto ou frase em ${targetLangName}",
  "pronuncia": "A fonética para um brasileiro ler",
  "texto_completo": "A frase completa de ensino."
}`
              },
              {
                role: "user",
                content: [
                  { type: "text", text: text },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/jpeg;base64,${image}`,
                    },
                  },
                ],
              },
            ],
            response_format: { type: "json_object" },
          });

          const aiData = JSON.parse(response.choices[0].message.content);

          // 1. Enviar texto para o frontend
          clientWs.send(JSON.stringify({
            type: 'text_update',
            text: aiData.resposta_pt,
            targetText: aiData.termo_target,
            pronunciation: aiData.pronuncia,
            full_text: aiData.texto_completo
          }));

          // 2. Gerar Áudio via ElevenLabs
          const textToSpeak = `${aiData.resposta_pt}. Em ${targetLangName} dizemos: ${aiData.termo_target}. Repita comigo: ${aiData.termo_target}.`;
          
          console.log(`🎙️ [VISION-OPENAI-${id}] Generating audio: ${aiData.termo_target}`);
          
          await handleElevenLabs(textToSpeak, 'basics1', targetLang, (audioChunk) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(audioChunk);
            }
          });

          clientWs.send(JSON.stringify({ type: 'audio_done' }));
        }
      } catch (err) {
        console.error(`❌ [VISION-OPENAI-${id}] Error:`, err);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: "Erro na análise da OpenAI. Verifique seus créditos." }));
        }
      }
    });

    clientWs.on('close', () => {
      console.log(`🔌 [VISION-OPENAI-${id}] Disconnected`);
    });
  });

  return wssVision;
}

module.exports = { setupLiveVision };
