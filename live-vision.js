const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleElevenLabs } = require('./elevenlabs');
const WebSocket = require('ws');

// Inicializa provedores
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, { apiVersion: 'v1' });

function setupLiveVision(server) {
  const wssVision = new WebSocket.Server({ noServer: true });

  wssVision.on('connection', (clientWs, request) => {
    const id = Math.random().toString(36).substr(2, 6).toUpperCase();
    const urlStr = request ? request.url : '';
    const langMatch = urlStr.match(/lang=([^&]*)/);
    const targetLang = langMatch ? langMatch[1] : 'en';
    const targetLangName = targetLang === 'zh' ? 'Mandarim' : 'Inglês';

    console.log(`👁️ [VISION-${id}] Session Started (${targetLangName})`);

    clientWs.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (!data.vision_input) return;

        const { image, text = "O que você está vendo?" } = data.vision_input;
        let aiData = null;
        let providerUsed = "";

        // 1. VISÃO (OpenAI -> Gemini Fallback)
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Você é o Tutor LingoLoom. Analise a imagem e responda APENAS JSON puro: 
                {
                  "resposta_pt": "O que é o objeto em português", 
                  "termo_target": "O nome do objeto em inglês", 
                  "explicacao_en": "Uma frase curta em inglês explicando o uso do objeto",
                  "pronuncia": "Como se pronuncia foneticamente", 
                  "texto_completo": "Uma frase curta em português"
                }`
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
          });
          aiData = JSON.parse(response.choices[0].message.content);
          providerUsed = "OpenAI";
        } catch (visionErr) {
          console.log(`⚠️ OpenAI Vision failed, trying Gemini...`);
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          const result = await model.generateContent([
            `LingoLoom Tutor. Responda APENAS JSON: {"resposta_pt": "...", "termo_target": "...", "explicacao_en": "...", "pronuncia": "...", "texto_completo": "..."}`,
            { inlineData: { data: image, mimeType: "image/jpeg" } }
          ]);
          const freshText = result.response.text().replace(/```json|```/g, '').trim();
          aiData = JSON.parse(freshText);
          providerUsed = "Gemini";
        }

        // Enviar os dados de texto IMEDIATAMENTE
        clientWs.send(JSON.stringify({
          type: 'text_update',
          text: aiData.resposta_pt,
          targetText: aiData.termo_target,
          pronunciation: aiData.pronuncia,
          full_text: aiData.texto_completo
        }));

        // 2. VOZ (Português + Explicação em Inglês)
        const textToSpeak = `${aiData.resposta_pt}. In English we call it ${aiData.termo_target}. ${aiData.explicacao_en}. Repeat with me: ${aiData.termo_target}.`;
        
        try {
          console.log(`🎙️ [VOICE] Attempting Premium Voice (ElevenLabs)...`);
          await handleElevenLabs(textToSpeak, 'basics1', targetLang, (audioChunk) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(audioChunk);
          });
          clientWs.send(JSON.stringify({ type: 'audio_done' }));
        } catch (audioErr) {
          console.error(`⚠️ ElevenLabs failed: ${audioErr.message}. Triggering Local Voice...`);
          // Avisa o frontend para usar a voz do sistema (Google/Apple)
          clientWs.send(JSON.stringify({ 
            type: 'use_local_voice', 
            text_to_speak: textToSpeak,
            lang_code: targetLang === 'zh' ? 'zh-CN' : 'en-US'
          }));
        }

      } catch (err) {
        console.error(`❌ Global error:`, err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ error: "Erro de processamento." }));
        }
      }
    });

    clientWs.on('close', () => console.log(`🔌 [VISION-${id}] Disconnected`));
  });

  return wssVision;
}

module.exports = { setupLiveVision };
