require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { handleGemini } = require('./gemini');
const { handleElevenLabs } = require('./elevenlabs');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);

// Legacy text-to-speech socket (we can leave this for backwards compatibility for older clients, mounted on root path)
// Actually wss binds to server, but we need to prevent it from intercepting our `/live` upgrade.
const wss = new WebSocket.Server({ noServer: true });

const { setupLiveRelay } = require('./gemini-live');
const liveWss = setupLiveRelay(server);

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  
  if (pathname === '/live') {
    liveWss.handleUpgrade(request, socket, head, (ws) => {
      liveWss.emit('connection', ws, request);
    });
  } else {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mockMode: String(process.env.MOCK_MODE).trim() === 'true',
    timestamp: new Date().toISOString(),
  });
});

// ── Translation endpoint for Subtitles ───────────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/translate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text is required' });
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Translate the following text exactly to Portuguese (Brazil). Respond ONLY with the translation, nothing else.\nText: ${text}`;
    const result = await model.generateContent(prompt);
    res.json({ translation: result.response.text().trim() });
  } catch (e) {
    console.error("Translation error", e);
    res.status(500).json({ error: 'Failed to translate' });
  }
});

// ── WebSocket handler ─────────────────────────────────────────
wss.on('connection', (ws) => {
  const id = Math.random().toString(36).substr(2, 6).toUpperCase();
  console.log(`🔌 [${id}] Client connected`);

  const send = (obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  send({ type: 'connected', mockMode: String(process.env.MOCK_MODE).trim() === 'true' });

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return send({ type: 'error', message: 'Invalid JSON' });
    }

    const { text, scenario = 'airport', language = 'en', learnerMode = false, difficulty = 'beginner' } = data;
    if (!text?.trim()) return send({ type: 'error', message: 'Text is required' });

    console.log(`📨 [${id}] [${scenario}/${language}${learnerMode ? '+Learner' : ''} D:${difficulty}]: "${text}"`);

    try {
      send({ type: 'status', status: 'processing' });

      // 1. Gemini → structured JSON
      const aiResponse = await handleGemini(text, scenario, language, learnerMode, difficulty);
      console.log(`🤖 [${id}] Response: "${aiResponse.resposta.substring(0, 60)}..."`);

      // 2. Send text immediately (frontend renders while audio loads)
      send({ type: 'text_response', data: aiResponse });

      // 3. Start audio streaming
      send({ type: 'status', status: 'speaking' });

      const audioChunks = [];
      await handleElevenLabs(aiResponse.resposta, scenario, language, (chunk) => {
        audioChunks.push(chunk);
      });

      // Send all audio as one binary payload (works for WAV mock + MP3 real)
      if (audioChunks.length > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.concat(audioChunks));
      }

      send({ type: 'audio_done' });
      send({ type: 'status', status: 'idle' });

    } catch (err) {
      console.error(`❌ [${id}] Error:`, err.message);
      send({ type: 'error', message: err.message });
      send({ type: 'status', status: 'idle' });
    }
  });

  ws.on('close', () => console.log(`🔌 [${id}] Disconnected`));
  ws.on('error', (err) => console.error(`⚠️  [${id}] WS error:`, err.message));
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('┌──────────────────────────────────────────────┐');
  console.log('│        🌍  ImmigrantVoice AI  Backend        │');
  console.log('├──────────────────────────────────────────────┤');
  console.log(`│  🚀  Local:   http://localhost:${PORT}           │`);
  console.log(`│  🌐  Network: http://0.0.0.0:${PORT}             │`);
  console.log(`│  🎭  Mock Mode : ${String(process.env.MOCK_MODE).trim() === 'true' ? 'ON ' : 'OFF'}  │`);
  console.log('└──────────────────────────────────────────────┘');
  console.log('');
});
