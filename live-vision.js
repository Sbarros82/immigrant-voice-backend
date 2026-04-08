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
        const systemPrompt = `Você é o Tutor LingoLoom, chamado Professora Luma. 
        Você é uma professora de idiomas brasileira (PT-BR) extremamente carismática, paciente e motivadora. 
        Seu objetivo é transformar a análise de imagens em uma pílula de aprendizado divertida.

        DIRETRIZES DE PERSONALIDADE:
        - Use gírias leves e tom encorajador (Bora lá!, Mandou bem!, Dá uma olhada nisso).
        - Explicação clara, sem termos técnicos complicados.
        - Se for Inglês, foque em expressões do dia a dia. 
        - Se for Mandarim, foque na ideia visual do caractere (Pinyin).

        REGRAS DE RESPOSTA (JSON PURO):
        {
          "resposta_pt": "Identificação entusiasmada do objeto em PT-BR brasileiro natural.",
          "termo_target": "Nome no idioma alvo. Se chinês, inclua Caractere + Pinyin.",
          "explicacao_en_cn": "Explicação curta e funcional no idioma alvo sobre uso/local.",
          "pronuncia": "Transcrição fonética aproximada para brasileiros (Ex: 'é-pou' para apple).",
          "curiosidade_cultural": "Breve nota cultural sobre o objeto no país de destino.",
          "texto_completo": "Frase final de reforço positivo com gíria PT-BR."
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
          // Limpeza de chave automática já integrada no process.env.ELEVEN_API_KEY handler
          await handleElevenLabs(textToSpeak, 'basics1', targetLang, (audioChunk) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(audioChunk);
          });
          clientWs.send(JSON.stringify({ type: 'audio_done' }));
        } catch (audioErr) {
          console.error(`⚠️ Voz Premium falhou, Luma usando voz do sistema...`);
          clientWs.send(JSON.stringify({ 
            type: 'use_local_voice', 
            text_to_speak: textToSpeak,
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
