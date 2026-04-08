require('dotenv').config();
const axios = require('axios');

async function testEleven() {
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4llvDq8ikWAM/stream`,
      { text: "Test", model_id: 'eleven_multilingual_v2' },
      { headers: { 'xi-api-key': process.env.ELEVEN_API_KEY }, responseType: 'arraybuffer' }
    );
    console.log("✅ ElevenLabs OK");
  } catch (err) {
    console.error("❌ ElevenLabs Error:", err.response?.status, err.message);
  }
}

testEleven();
