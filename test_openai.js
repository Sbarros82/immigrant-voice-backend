require('dotenv').config();
const OpenAI = require('openai');

async function testOpenAI() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Test" }],
      max_tokens: 5,
    });
    console.log("✅ OpenAI OK");
  } catch (err) {
    console.error("❌ OpenAI Error:", err.status, err.message);
  }
}

testOpenAI();
