const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleElevenLabs } = require('./elevenlabs');
const WebSocket = require('ws');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function setupLiveVision(server) {
  const wssVision = new WebSocket.Server({ noServer: true });

  wssVision.on('connection', (clientWs, request) => {
    const id = Math.random().toString(36).substr(2, 6).toUpperCase();
    const urlStr = request ? request.url : '';
    const langMatch = urlStr.match(/lang=([^&]*)/);
    const targetLang = langMatch ? langMatch[1] : 'en';
    const targetLangName = targetLang === 'zh' ? 'Mandarim' : 'Inglês';

    console.log(`👁️ [VISION-${id}] Client connected. Target: ${targetLangName}`);

    clientWs.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Se receber um frame de visão + texto ou apenas frame
        if (data.vision_input) {
          const { image, text = "O que você está vendo agora?" } = data.vision_input;
          
          console.log(`📸 [VISION-${id}] Processing frame...`);
          
          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
          
          const prompt = `Você é a LingoLoom, uma professora de idiomas paciente e inteligente com visão computacional.
O usuário está apontando a câmera para algo e perguntou: "${text}".

Sua tarefa:
1. Identifique o objeto ou cenário na imagem.
2. Responda em PORTUGUÊS (Brasil) de forma amigável, explicando o que é.
3. Ensine como dizer o nome desse objeto ou uma frase útil relacionada em ${targetLangName}.
4. Forneça a tradução exata e a pronúncia fonética (ajudando um brasileiro a ler).

Responda SEMPRE no seguinte formato JSON (sem markdown):
{
  "resposta_pt": "Sua explicação amigável em português aqui.",
  "termo_target": "O nome do objeto ou frase em ${targetLangName}",
  "pronuncia": "A fonética para um brasileiro ler (ex: 'cóf-i' para coffee ou pinyin para mandarim)",
  "texto_completo": "A frase completa que o usuário deve aprender."
}
`;

          const result = await model.generateContent([
            prompt,
            {
              inlineData: {
                data: image,
                mimeType: "image/jpeg"
              }
            }
          ]);

          const responseText = result.response.text();
          let aiData;
          try {
            // Limpa possíveis markdowns que o modelo insista em colocar
            const cleanJson = responseText.replace(/```json|```/g, '').trim();
            aiData = JSON.parse(cleanJson);
          } catch (e) {
            console.error("JSON Parse Error from Gemini Vision:", responseText);
            aiData = {
                resposta_pt: "Identifiquei algo interessante! " + responseText.substring(0, 100),
                termo_target: "Objeto identificado",
                pronuncia: "",
                texto_completo: responseText
            };
          }

          // 1. Enviar texto imediatamente para o frontend
          clientWs.send(JSON.stringify({
            type: 'text_update',
            text: aiData.resposta_pt,
            targetText: aiData.termo_target,
            pronunciation: aiData.pronuncia,
            full_text: aiData.texto_completo
          }));

          // 2. Gerar Áudio via ElevenLabs (opcionalmente passamos o texto em PT ou a frase completa)
          // Vamos narrar a explicação em PT + o termo em Target Lang
          const textToSpeak = `${aiData.resposta_pt}. Em ${targetLangName} dizemos: ${aiData.termo_target}. Repita comigo: ${aiData.termo_target}.`;
          
          console.log(`🎙️ [VISION-${id}] Generating audio for: ${aiData.termo_target}`);
          
          await handleElevenLabs(textToSpeak, 'basics1', targetLang, (audioChunk) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(audioChunk);
            }
          });

          clientWs.send(JSON.stringify({ type: 'audio_done' }));
        }
      } catch (err) {
        console.error(`❌ [VISION-${id}] Error:`, err);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: err.message }));
        }
      }
    });

    clientWs.on('close', () => {
      console.log(`🔌 [VISION-${id}] Client disconnected`);
    });
  });

  return wssVision;
}

module.exports = { setupLiveVision };
