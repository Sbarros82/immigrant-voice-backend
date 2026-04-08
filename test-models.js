const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    // There isn't a direct listModels in the standard SDK easily accessible without extra headers usually,
    // but we can try to hit a known model.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const result = await model.generateContent("test");
    console.log("SUCCESS with gemini-1.5-flash-latest");
  } catch (e) {
    console.error("FAILED with gemini-1.5-flash-latest:", e.message);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("test");
    console.log("SUCCESS with gemini-1.5-flash");
  } catch (e) {
    console.error("FAILED with gemini-1.5-flash:", e.message);
  }
}

listModels();
