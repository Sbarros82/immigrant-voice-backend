require('dotenv').config();
const { buildGeminiPrompt } = require('./prompts');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

// ───────────────────────────────────────────────────────────────
// Mock responses (used when MOCK_MODE=true)
// ───────────────────────────────────────────────────────────────
const MOCK_RESPONSES = {
  en: {
    airport:     ["Good morning! Please present your passport and boarding pass. What is the purpose of your visit today?", "Welcome! How long do you intend to stay, and where will you be residing during your trip?", "I need to verify your documents. Do you have anything to declare at customs?"],
    hospital:    ["Hello, I'm the triage nurse. Can you describe your main symptoms? On a scale of 1 to 10, how would you rate your pain?", "Do you have any allergies to medications? Are you currently taking any prescriptions?", "Let me take your vitals. When did these symptoms start?"],
    bank:        ["Good afternoon! How can I assist you today? Are you looking to open an account or make a transaction?", "I can help you with that. Do you have a valid photo ID and your supporting documents?", "For security purposes, I'll need to verify your identity. Can you provide your account number?"],
    school:      ["Welcome to our enrollment office! Are you here to register a new student or inquire about our programs?", "We'll need the student's birth certificate, vaccination records, and proof of address. Do you have those?", "Our new academic year starts in September. Would you like me to walk you through the enrollment steps?"],
    supermarket: ["Hi there! Can I help you find something? We've just restocked our fresh produce section.", "That item is in aisle 7, near the back. Would you like me to show you?", "We have a buy-two-get-one-free offer on dairy products today. Is there anything else I can help with?"],
    police:      ["Good day. How can I assist you? Please state your name and the nature of your concern.", "I understand. Can you describe the incident in detail? Approximately when did this occur?", "I'll need to file a formal report. Do you have any witnesses or supporting evidence?"],
  },
  zh: {
    airport:     ["早上好！请出示您的护照和登机牌。您此次来访的目的是什么？", "欢迎！您计划停留多长时间，旅途中将居住在哪里？", "我需要核实您的文件。今天有什么需要向海关申报的吗？"],
    hospital:    ["您好，我是分诊护士。能描述一下您的主要症状吗？从1到10分，您的疼痛程度如何？", "您对任何药物有过敏反应吗？您目前正在服用处方药吗？", "让我为您量一下生命体征。这些症状是什么时候开始的？"],
    bank:        ["下午好！今天有什么可以帮助您的？您是想开户还是办理交易？", "我可以帮您处理。您带了有效的带照片身份证和相关文件吗？", "为了安全起见，我需要验证您的身份。您能提供账户号码吗？"],
    school:      ["欢迎来到我们的招生办公室！您是来为新学生报名还是咨询我们的课程？", "我们需要学生的出生证明、疫苗记录和居住证明。您带了这些文件吗？", "我们新学年从九月开始。您想让我逐步解释入学流程吗？"],
    supermarket: ["您好！今天有什么需要帮助的吗？我们刚刚补充了新鲜农产品区。", "那件商品在第7走道，靠近商店后面。需要我带您过去吗？", "今天所有乳制品有买二送一的优惠。还有其他需要帮助的吗？"],
    police:      ["您好。有什么我可以帮助您的？请报上您的名字和需要解决的问题。", "我明白了。您能尽可能详细地描述一下事件经过吗？大概是什么时候发生的？", "我需要填写一份正式报告。您有证人或相关证据吗？"],
  },
};

// Simple grammar checker for English mock mode
function detectGrammarError(text) {
  const checks = [
    { re: /\bi has\b/i,        fix: (s) => s.replace(/\bi has\b/i, 'I have'),        note: "Use 'have' com 'I'. Correto: 'I have a question' ✓" },
    { re: /\bhe have\b/i,      fix: (s) => s.replace(/\bhe have\b/i, 'he has'),       note: "Use 'has' com 'he/she/it'. Correto: 'He has a passport' ✓" },
    { re: /\bshe have\b/i,     fix: (s) => s.replace(/\bshe have\b/i, 'she has'),     note: "Use 'has' com 'he/she/it'. Correto: 'She has documents' ✓" },
    { re: /\bi are\b/i,        fix: (s) => s.replace(/\bi are\b/i, 'I am'),           note: "Use 'am' com 'I'. Correto: 'I am here' ✓" },
    { re: /\bwe is\b/i,        fix: (s) => s.replace(/\bwe is\b/i, 'we are'),         note: "Use 'are' com 'we/you/they'. Correto: 'We are ready' ✓" },
    { re: /\bthey is\b/i,      fix: (s) => s.replace(/\bthey is\b/i, 'they are'),     note: "Use 'are' com 'they'. Correto: 'They are here' ✓" },
    { re: /\ba appointment\b/i,fix: (s) => s.replace(/\ba appointment\b/i, 'an appointment'), note: "Use 'an' antes de palavras que começam com vogal. Correto: 'an appointment' ✓" },
    { re: /\ba hour\b/i,       fix: (s) => s.replace(/\ba hour\b/i, 'an hour'),       note: "Use 'an' antes de 'h' silencioso. Correto: 'an hour' ✓" },
    { re: /\bmore better\b/i,  fix: (s) => s.replace(/\bmore better\b/i, 'better'),   note: "'Better' já é comparativo. Não adicione 'more'. Correto: 'This is better' ✓" },
  ];
  for (const { re, fix, note } of checks) {
    if (re.test(text)) {
      return { tem_erro: true, original: text, correto: fix(text), explicacao: note };
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────
// Helper: extract JSON from AI response (handles markdown code blocks)
// ───────────────────────────────────────────────────────────────
function extractJSON(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not find JSON in response: ' + raw.substring(0, 200));
  return JSON.parse(match[0]);
}

// ───────────────────────────────────────────────────────────────
// OpenAI provider
// ───────────────────────────────────────────────────────────────
async function callOpenAI(prompt) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  console.log(`🤖 [OpenAI] Calling model: ${model}`);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a multilingual AI language tutor and scenario simulator. Always respond with valid JSON only. Never use markdown code blocks in your response.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 600,
  });

  const raw = completion.choices[0]?.message?.content || '';
  return extractJSON(raw);
}

// ───────────────────────────────────────────────────────────────
// Gemini provider
// ───────────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

  console.log(`🧠 [Gemini] Calling model: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}`);

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const raw = response.text();
  return extractJSON(raw);
}

// ───────────────────────────────────────────────────────────────
// Main handler — routes to the correct provider with fallback
// ───────────────────────────────────────────────────────────────
async function handleGemini(userText, scenario, language, learnerMode = false, difficulty = 'beginner') {
  // ── Mock mode ──────────────────────────────────────────────
  if (String(process.env.MOCK_MODE).trim() === 'true') {
    console.log(`🎭 Mock AI response (${learnerMode ? 'Learner Mode' : 'Normal'})`);
    await new Promise(r => setTimeout(r, 600 + Math.random() * 800));

    const langKey = language === 'zh' ? 'zh' : 'en';
    const pool = MOCK_RESPONSES[langKey][scenario] || MOCK_RESPONSES[langKey].airport || ['Mock default message'];
    const resposta = pool[Math.floor(Math.random() * pool.length)];

    let correcao_gramatical = null;
    if (learnerMode) {
      correcao_gramatical = {
        tem_erro: true,
        original: userText,
        correto: '[Translation needed]',
        explicacao: `Você falou em Português: "${userText}". No modo real, eu te ensinaria a dizer isso em ${language === 'zh' ? 'Mandarim' : 'Inglês'}.`,
      };
    } else if (language === 'en') {
      correcao_gramatical = detectGrammarError(userText);
    }

    const words = userText.split(' ').length;
    const nivel_fluencia = language === 'zh'
      ? (words > 10 ? 'HSK 3' : words > 5 ? 'HSK 2' : 'HSK 1')
      : (words > 15 ? 'B2' : words > 8 ? 'B1' : words > 4 ? 'A2' : 'A1');

    return {
      resposta,
      traducao: `[Tradução simulada ${learnerMode ? 'aprendiz' : 'normal'}] ${resposta.substring(0, 20)}...`,
      pronuncia: '[Mock Phonetics / Pinyin]',
      correcao_gramatical,
      nivel_fluencia,
    };
  }

  // ── Real AI call ───────────────────────────────────────────
  const prompt = buildGeminiPrompt(userText, scenario, language, learnerMode, difficulty);
  const provider = String(process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();

  // Primary provider
  if (provider === 'openai') {
    try {
      const result = await callOpenAI(prompt);
      console.log(`✅ [OpenAI] Response OK`);
      return result;
    } catch (err) {
      console.warn(`⚠️  [OpenAI] Failed: ${err.message} — falling back to Gemini…`);
      // Fallback to Gemini
      try {
        const result = await callGemini(prompt);
        console.log(`✅ [Gemini] Fallback Response OK`);
        return result;
      } catch (geminiErr) {
        console.error('❌ [Gemini] Fallback also failed:', geminiErr.message);
        throw geminiErr;
      }
    }
  }

  // Default: Gemini, with OpenAI as fallback
  try {
    const result = await callGemini(prompt);
    console.log(`✅ [Gemini] Response OK`);
    return result;
  } catch (err) {
    console.warn(`⚠️  [Gemini] Failed: ${err.message} — falling back to OpenAI…`);
    try {
      const result = await callOpenAI(prompt);
      console.log(`✅ [OpenAI] Fallback Response OK`);
      return result;
    } catch (openaiErr) {
      console.error('❌ [OpenAI] Fallback also failed:', openaiErr.message);
      throw openaiErr;
    }
  }
}

module.exports = { handleGemini };
