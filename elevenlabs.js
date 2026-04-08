require('dotenv').config();
const axios = require('axios');
const { getVoiceId } = require('./voices');

// ───────────────────────────────────────────────────────────────
// Generate a realistic WAV beep for mock mode
// ───────────────────────────────────────────────────────────────
function generateMockWav(durationMs = 800) {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);        // PCM subchunk size
  buf.writeUInt16LE(1, 20);         // PCM format
  buf.writeUInt16LE(1, 22);         // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);         // block align
  buf.writeUInt16LE(16, 34);        // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  const fadeSamples = Math.floor(sampleRate * 0.04); // 40 ms fade
  const freq = 440;

  for (let i = 0; i < numSamples; i++) {
    let amp = 0.25;
    if (i < fadeSamples) amp *= i / fadeSamples;
    else if (i > numSamples - fadeSamples) amp *= (numSamples - i) / fadeSamples;
    const sample = Math.round(amp * 32767 * Math.sin(2 * Math.PI * freq * i / sampleRate));
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

async function handleElevenLabs(text, scenario, language, onChunk) {
  if (process.env.MOCK_MODE === 'true' || process.env.ELEVEN_MOCK === 'true') {
    console.log('🎭 Mock ElevenLabs audio');
    await new Promise(r => setTimeout(r, 400));
    // Duration proportional to text length (approx 120 chars/sec speech rate)
    const duration = Math.min(Math.max(text.length * 55, 600), 4000);
    onChunk(generateMockWav(duration));
    return;
  }

// ── Real ElevenLabs streaming TTS ────────────────────────────
  const voiceId = getVoiceId(scenario, language);
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.9,
          style: 0.45,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key': (process.env.ELEVEN_API_KEY || '').replace(/^sk[_|-]/, '').trim(),
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'stream',
      }
    );

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => onChunk(chunk));
      response.data.on('end', resolve);
      response.data.on('error', reject);
    }).catch(err => {
      console.error("ElevenLabs stream chunking error:", err);
      throw err;
    });
  } catch (error) {
    let errMsg = error.message;
    if (error.response && error.response.data) {
       console.error("ElevenLabs API Error:", error.response.status, error.response.statusText);
    } else {
       console.error("ElevenLabs network error:", error.message);
    }
    throw error;
  }
}

module.exports = { handleElevenLabs };
