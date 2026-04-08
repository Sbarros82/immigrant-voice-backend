const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleOpenAITTS } = require('./openai-tts');
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

    console.log(`👩‍🏫 [LUMA-${id}] Professora Luma Online (${targetLangName})`);

    clientWs.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // --- VALIDAÇÃO DE PRONÚNCIA (OUVIDO DA LUMA) ---
        if (data.type === 'user_voice_data' && data.audio) {
            console.log(`👂 [LUMA] Validando pronúncia de: ${data.target}`);
            try {
              const buffer = Buffer.from(data.audio, 'base64');
              const fileName = `/tmp/user_voice_${id}.webm`;
              const fs = require('fs');
              fs.writeFileSync(fileName, buffer);

              const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(fileName),
                model: "whisper-1",
              });

              const spokenText = transcription.text.toLowerCase().replace(/[.,!?;]/g, '').trim();
              const targetLower = (data.target || "").toLowerCase().replace(/[.,!?;]/g, '').trim();

              console.log(`📝 [LUMA] Aluno falou: "${spokenText}" (Esperado: "${targetLower}")`);

              // Verificação Simples de Acerto
              const success = spokenText.includes(targetLower) || targetLower.includes(spokenText);

              if (success) {
                console.log("✅ Pronúncia correta! Comemorando...");
                clientWs.send(JSON.stringify({ 
                  type: 'pronunciation_feedback', 
                  success: true 
                }));
              }
              
              // Limpa arquivo temporário
              fs.unlinkSync(fileName);
            } catch (err) {
              console.error("❌ Erro na audição da Luma:", err.message);
            }
            return;
        }

        if (!data.vision_input) return;

        const { image, text = "O que é isso?" } = data.vision_input;
        let aiData = null;

        // PROMPT DA PROFESSORA LUMA
        const systemPrompt = `Você é a Professora Luma 3.0, uma assistente analítica e mentora brasileira (PT-BR) de elite. 
        
        SUA MISSÃO:
        Você é multitarefa. Além de ensinar idiomas, você é especialista em:
        1. MATEMÁTICA: Se ver uma conta ou equação, resolva e explique o passo a passo.
        2. DOCUMENTOS: Se ver um texto, tabela ou documento, resuma os pontos principais e explique-os.
        3. OBJETOS: Continue ensinando nomes de objetos nos idiomas alvo.
        4. ASSISTÊNCIA GERAL: Responda de forma inteligente a qualquer solicitação visual.

        DIRETRIZES DE PERSONALIDADE:
        - Use um português do Brasil EXTREMAMENTE natural e coloquial ("tá", "pra", "bora").
        - Seja didática, carismática e MUITO clara na explicação.
        - Se for uma conta de matemática, seja encorajadora: "Essa é fácil, vem comigo!".

        REGRAS DE RESPOSTA (JSON PURO):
        {
          "resposta_pt": "Explicação ou identificação principal em PT-BR (Didática e direta).",
          "termo_target": "Termo principal no idioma alvo (ou 'N/A' se for apenas matemática/doc).",
          "explicacao_en_cn": "Breve explicação técnica ou resumo no idioma alvo.",
          "pronuncia": "Transcrição fonética se houver termo novo, ou 'N/A'.",
          "curiosidade_cultural": "Fato interessante sobre o assunto ou dica de uso.",
          "texto_completo": "A frase exata que você quer que a Luma fale (deve ser Completa e Natural)."
        }`;

        // 1. VISÃO (OpenAI -> Gemini Fallback)
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: `Luma, o que é isso aqui que eu estou vendo? ${text}` },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
                ],
              },
            ],
            response_format: { type: "json_object" },
          });
          aiData = JSON.parse(response.choices[0].message.content);
        } catch (visionErr) {
          console.log(`⚠️ OpenAI falhou, Luma pedindo ajuda pro Gemini...`);
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          const result = await model.generateContent([
            `${systemPrompt}\nResponda APENAS JSON.`,
            { inlineData: { data: image, mimeType: "image/jpeg" } }
          ]);
          const freshText = result.response.text().replace(/```json|```/g, '').trim();
          aiData = JSON.parse(freshText);
        }

        // 2. ENVIAR DADOS COMPLETOS PARA A UI
        clientWs.send(JSON.stringify({
          type: 'luma_update',
          ...aiData
        }));

        // 3. VOZ DA LUMA (Personalidade e Cultura)
        const textToSpeak = `${aiData.resposta_pt}. 
        In ${targetLangName} we say: ${aiData.termo_target}. 
        ${aiData.explicacao_en_cn}. 
        Dica da Luma: ${aiData.curiosidade_cultural}. 
        Repita agora: ${aiData.termo_target}. 
        ${aiData.texto_completo}`;
        
        try {
          await handleOpenAITTS(aiData.texto_completo, (audioChunk) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(audioChunk);
          });
          clientWs.send(JSON.stringify({ type: 'audio_done' }));
        } catch (audioErr) {
          console.error(`⚠️ Voz OpenAI falhou, Luma usando voz do sistema...`);
          clientWs.send(JSON.stringify({ 
            type: 'use_local_voice', 
            text_to_speak: aiData.texto_completo,
            lang_code: targetLang === 'zh' ? 'zh-CN' : 'en-US'
          }));
        }

      } catch (err) {
        console.error(`❌ Erro Crítico:`, err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ error: "Luma teve um pequeno contratempo, tente de novo!" }));
        }
      }
    });

    clientWs.on('close', () => console.log(`🔌 [LUMA-${id}] Luma saiu da sala`));
  });

  return wssVision;
}

module.exports = { setupLiveVision };
