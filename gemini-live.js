const WebSocket = require('ws');

function setupLiveRelay(server) {
  const wssLive = new WebSocket.Server({ noServer: true });

  wssLive.on('connection', (clientWs) => {
    const id = Math.random().toString(36).substr(2, 6).toUpperCase();
    console.log(`📹 [LIVE-${id}] Client connected to LingoLoom Live`);

    // Usaremos v1beta que é o padrão atual para o Gemini 2.0 / 3.1 Live
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    const geminiWs = new WebSocket(geminiUrl);

    let isSetupDone = false;
    const messageQueue = [];

    geminiWs.on('open', () => {
      console.log(`☁️ [LIVE-${id}] Connected to Google Gemini`);
      
      const setupMsg = {
        setup: {
          model: "models/gemini-3.1-flash-live-preview",
          system_instruction: {
            parts: [{
              text: `You are LingoLoom, a conversational English teacher for beginners.
              - The user speaks Portuguese. You speak simple, clear English.
              - RESPOND IMMEDIATELY and briefly (1 short sentence max).
              - Use camera frames to help the user identify surroundings if they ask.
              - Do not include technical terms or complicated grammar.`
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
