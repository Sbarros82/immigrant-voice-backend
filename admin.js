const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const BRAIN_PATH = path.join(__dirname, 'knowledge', 'LUMA_BRAIN.md');

// GET /admin/knowledge
router.get('/knowledge', (req, res) => {
  try {
    if (!fs.existsSync(BRAIN_PATH)) {
      return res.json({ content: '' });
    }
    const content = fs.readFileSync(BRAIN_PATH, 'utf8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ler o arquivo de conhecimento.' });
  }
});

// POST /admin/knowledge
router.post('/knowledge', (req, res) => {
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'Conteúdo vazio.' });

  try {
    const dir = path.dirname(BRAIN_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(BRAIN_PATH, content, 'utf8');
    res.json({ success: true, message: 'Conhecimento atualizado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar o arquivo de conhecimento.' });
  }
});

module.exports = router;
