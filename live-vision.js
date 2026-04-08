const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleElevenLabs } = require('./elevenlabs');
const WebSocket = require('ws');

// Inicializa ambos os provedores
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Usamos a versão v1 explicitamente aqui para evitar o erro 404 do Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, { apiVersion: 'v1' });

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
        let lastError = "";

        // 1. Tenta OpenAI (GPT-4o-mini)
        try {
          console.log(`📸 [VISION-${id}] Attempting OpenAI...`);
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Você é a LingoLoom. Identifique o objeto e responda em JSON: {"resposta_pt": "...", "termo_target": "...", "pronuncia": "...", "texto_completo": "..."}`
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
        } catch (openaiErr) {
          lastError = `OpenAI: ${openaiErr.message}`;
          console.error(`⚠️ [VISION-${id}] OpenAI Failed: ${openaiErr.message}. Trying Gemini...`);
          
          // 2. Tenta Gemini (Fallback)
          try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const prompt = `Você é a LingoLoom. Identifique o objeto e ensine em ${targetLangName}. Responda APENAS JSON puro: {"resposta_pt": "...", "termo_target": "...", "pronuncia": "...", "texto_completo": "..."}`;

            const result = await model.generateContent([
              prompt,
              { inlineData: { data: image, mimeType: "image/jpeg" } }
            ]);

            const responseText = result.response.text();
            const cleanJson = responseText.replace(/```json|```/g, '').trim();
            aiData = JSON.parse(cleanJson);
            providerUsed = "Gemini";
          } catch (geminiErr) {
            lastError += ` | Gemini: ${geminiErr.message}`;
            throw new Error(lastError); // Ambos falharam
          }
        }

        console.log(`✅ [VISION-${id}] Success via ${providerUsed}`);

        // Enviar para o frontend e gerar áudio...
        clientWs.send(JSON.stringify({
          type: 'text_update',
          text: aiData.resposta_pt,
          targetText: aiData.termo_target,
          pronunciation: aiData.pronuncia,
          full_text: aiData.texto_completo
        }));

        const textToSpeak = `${aiData.resposta_pt}. Em ${targetLangName} dizemos: ${aiData.termo_target}. Repita comigo: ${aiData.termo_target}.`;
        await handleElevenLabs(textToSpeak, 'basics1', targetLang, (audioChunk) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(audioChunk);
        });
        clientWs.send(JSON.stringify({ type: 'audio_done' }));

      } catch (err) {
        console.error(`❌ [VISION-${id}] FAIURE:`, err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: `Dificuldade técnica: ${err.message}` }));
        }
      }
    });

    clientWs.on('close', () => console.log(`🔌 [VISION-${id}] Disconnected`));
  });

  return wssVision;
}

module.exports = { setupLiveVision };
