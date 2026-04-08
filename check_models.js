
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  try {
    console.log('🔍 Verificando modelos disponíveis para a sua chave...');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Tentativa de listar modelos
    // Nota: listModels requer permissão específica, mas vamos tentar ver se a chave aceita
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();

    if (data.error) {
      console.error('❌ Erro da API:', data.error.message);
      return;
    }

    console.log('✅ Modelos encontrados:');
    data.models.forEach(m => {
      console.log(`- ${m.name} (Suporta: ${m.supportedGenerationMethods.join(', ')})`);
    });
  } catch (err) {
    console.error('❌ Erro ao listar modelos:', err.message);
  }
}

listModels();
