const WebSocket = require('ws');

function setupLiveRelay(server) {
  const wssLive = new WebSocket.Server({ noServer: true });

  wssLive.on('connection', (clientWs, request) => {
    const id = Math.random().toString(36).substr(2, 6).toUpperCase();
    const urlStr = request ? request.url : '';
    const langMatch = urlStr.match(/lang=([^&]*)/);
    const lang = langMatch ? langMatch[1] : 'en';

    console.log(`📹 [LIVE-${id}] Client connected. Target Language: ${lang} `);

    // Usaremos v1beta que é o padrão atual para o Gemini 2.0 / 3.1 Live
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    const geminiWs = new WebSocket(geminiUrl);

    let isSetupDone = false;
    const messageQueue = [];

    const instructionEnglish = `Você é a LingoLoom, uma professora de inglês paciente e encorajadora.
- O aluno é brasileiro e está aprendendo INGLÊS.
- Fale com ele predominantemente em PORTUGUÊS (Brasil) para explicar conceitos, encorajar e incentivar.
- Quando for praticar ou perguntar como falar alguma coisa, diga a frase em Inglês para ele repetir.
- Corrija-o de forma gentil em português. Não dê respostas longas. Frases curtas e diretas.`;

    const instructionMandarin = `Você é a LingoLoom, uma professora de mandarim paciente e encorajadora.
- O aluno é brasileiro e está aprendendo MANDARIM.
- Fale com ele predominantemente em PORTUGUÊS (Brasil) para explicar conceitos e ensinar o vocabulário.
- Quando for praticar, fale as palavras em Mandarim com a pronúncia correta e peça para repetir.
- Corrija-o de forma gentil em português. Não dê respostas longas. Frases curtas e diretas.`;

    const instructionsText = lang === 'zh' ? instructionMandarin : instructionEnglish;

    geminiWs.on('open', () => {
      console.log(`☁️ [LIVE-${id}] Connected to Google Gemini`);
      
      const setupMsg = {
        setup: {
          model: "models/gemini-2.0-flash",
          system_instruction: {
            parts: [{
              text: instructionsText
            }]
          },
          generation_config: {
            response_modalities: ["AUDIO"]
          }
        }
      };
      geminiWs.send(JSON.stringify(setupMsg));
    });

    geminiWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.setupComplete) {
          console.log(`☁️ [LIVE-${id}] Setup Complete! Clearing queue...`);
          isSetupDone = true;
          while (messageQueue.length > 0) {
            const queued = messageQueue.shift();
            geminiWs.send(queued);
          }
          return;
        }

        // Log para ver se a IA está mandando áudio ou texto
        if (msg.serverContent) {
           console.log(`🤖 [LIVE-${id}] AI is responding... (Server Content received)`);
        }
        if (msg.error) {
           console.error(`❌ [LIVE-${id}] Gemini API Error:`, msg.error);
        }

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      } catch (err) {
        console.error(`⚠️ [LIVE-${id}] Error parsing Gemini message:`, err.message);
      }
    });

    clientWs.on('message', (data) => {
      // Se for um binário ou string, mandamos pro Gemini
      if (!isSetupDone || geminiWs.readyState !== WebSocket.OPEN) {
        messageQueue.push(data);
        if (messageQueue.length > 50) messageQueue.shift();
      } else {
        // Log de atividade (apenas para debug)
        if (id_counter++ % 5 === 0) { 
           console.log(`📤 [LIVE-${id}] Audio/Video chunk -> Gemini (${data.length} bytes)`);
        }
        geminiWs.send(data);
      }
    });

    let id_counter = 0;

    geminiWs.on('close', (code, reason) => {
      console.log(`☁️ [LIVE-${id}] Gemini closed: ${code} - ${reason}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: "Gemini connection lost", code, reason: reason.toString() }));
        clientWs.close();
      }
    });

    geminiWs.on('error', (err) => {
      console.error(`❌ [LIVE-${id}] Gemini Error:`, err);
    });

    clientWs.on('close', () => {
      console.log(`📹 [LIVE-${id}] Client disconnected`);
      if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    });
  });

  return wssLive;
}

module.exports = { setupLiveRelay };
