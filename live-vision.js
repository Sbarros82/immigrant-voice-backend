const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleOpenAITTS } = require('./openai-tts');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Carrega Repositório de Conhecimento
let knowledge = {};
try {
  const knowledgePath = path.join(__dirname, 'data', 'knowledge.json');
  if (fs.existsSync(knowledgePath)) {
    knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
  }
} catch (err) {
  console.error("⚠️ Erro ao carregar knowledge.json:", err.message);
}

// Inicializa provedores
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, { apiVersion: 'v1' });

function setupLiveVision(server) {
  const wssVision = new WebSocket.Server({ noServer: true });

  wssVision.on('connection', (clientWs, request) => {
    const id = Math.random().toString(36).substr(2, 6).toUpperCase();
    const urlStr = request ? request.url : '';
    const langMatch = urlStr.match(/lang=([^&]*)/);
    const modeMatch = urlStr.match(/mode=([^&]*)/); // NOVO: Captura o modo (math ou translate)
    
    const targetLang = langMatch ? langMatch[1] : 'en';
    const mode = modeMatch ? modeMatch[1] : 'tutor'; // Padrão é tutor (idiomas)
    const targetLangName = targetLang === 'zh' ? 'Mandarim' : 'Inglês';

    console.log(`👩‍🏫 [LUMA-${id}] Modo: ${mode.toUpperCase()} (${targetLangName})`);

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

        // PROMPT DINÂMICO BASEADO NO MODO
        let systemPrompt = "";

        if (mode === 'math') {
          systemPrompt = `Você é a Professora Luma Especialista em Matemática (Fundamental 1 e 2).
          REGRAS DE OURO: ${JSON.stringify(knowledge.math_rules)}
          Sua missão é ensinar, não apenas dar a resposta. Use analogias, seja paciente e extremamente clara.`;
        } else if (mode === 'translate') {
          systemPrompt = `Você é a Luma Tradutora de Elite e Analista de Documentos.
          REGRAS DE OURO: ${JSON.stringify(knowledge.translation_rules)}
          Sua missão é traduzir com contexto, explicar nuances e ajudar a entender textos complexos.`;
        } else {
          systemPrompt = `Você é a Professora Luma 3.0, uma assistente analítica e mentora brasileira (PT-BR) de elite. 
          Foco: Ensino de Idiomas (${targetLangName}) e Assistência Geral.
          Use um português natural ("tá", "pra", "bora"). Seja didática e carismática.`;
        }

        systemPrompt += `\nREGRAS DE RESPOSTA (JSON PURO):
        {
          "resposta_pt": "Explicação principal em PT-BR.",
          "termo_target": "Termo no idioma alvo (ou 'N/A').",
          "explicacao_en_cn": "Resumo ou tradução no idioma alvo.",
          "pronuncia": "Transcrição fonética ou 'N/A'.",
          "curiosidade_cultural": "Dica extra ou fato interessante.",
          "texto_completo": "A frase exata que você vai falar."
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
          await handleOpenAITTS(aiData.texto_completo, (fullAudioBuffer) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(fullAudioBuffer);
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
