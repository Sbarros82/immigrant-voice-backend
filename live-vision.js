const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleElevenLabs } = require('./elevenlabs');
const WebSocket = require('ws');

// Inicializa ambos os provedores
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
        if (!data.vision_input) return;

        const { image, text = "O que você está vendo agora?" } = data.vision_input;
        let aiData = null;
        let providerUsed = "";

        // Tenta PRIMEIRO a OpenAI
        try {
          console.log(`📸 [VISION-${id}] Attempting OpenAI (GPT-4o-mini)...`);
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Você é a LingoLoom, professora bilíngue. Responda em Português ensinando o objeto em ${targetLangName}. 
                Responda APENAS em JSON: {"resposta_pt": "...", "termo_target": "...", "pronuncia": "...", "texto_completo": "..."}`
              },
              {
                role: "user",
                content: [
                  { type: "text", text: text },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
                ],
              },
            ],
            response_format: { type: "json_object" },
            timeout: 8000
          });
          aiData = JSON.parse(response.choices[0].message.content);
          providerUsed = "OpenAI";
        } catch (openaiErr) {
          console.error(`⚠️ [VISION-${id}] OpenAI Failed (Code: ${openaiErr.status}). Switching to Gemini...`);
          
          // FALLBACK: Tenta o Gemini 1.5 Flash (Versão Estável)
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          const prompt = `Você é a LingoLoom, professora bilíngue. Responda em Português ensinando o objeto em ${targetLangName}. 
          Responda SEMPRE em JSON no seguinte formato (sem markdown):
          {"resposta_pt": "Sua explicação em português", "termo_target": "Nome em ${targetLangName}", "pronuncia": "Fonética para brasileiro", "texto_completo": "Frase de ensino"}`;

          const result = await model.generateContent([
            prompt,
            { inlineData: { data: image, mimeType: "image/jpeg" } }
          ]);

          const responseText = result.response.text();
          const cleanJson = responseText.replace(/```json|```/g, '').trim();
          aiData = JSON.parse(cleanJson);
          providerUsed = "Gemini";
        }

        console.log(`✅ [VISION-${id}] Result from ${providerUsed}`);

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
        await handleElevenLabs(textToSpeak, 'basics1', targetLang, (audioChunk) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(audioChunk);
          }
        });

        clientWs.send(JSON.stringify({ type: 'audio_done' }));

      } catch (err) {
        console.error(`❌ [VISION-${id}] All providers failed:`, err);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: "Desculpe, estou com dificuldades técnicas. Verifique suas chaves de API." }));
        }
      }
    });

    clientWs.on('close', () => console.log(`🔌 [VISION-${id}] Disconnected`));
  });

  return wssVision;
}

module.exports = { setupLiveVision };
