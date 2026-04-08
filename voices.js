// ElevenLabs Voice IDs mapped by scenario and language
// eleven_multilingual_v2 model supports both English and Mandarin

const VOICES = {
  en: {
    airport: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah',   accent: 'American, Formal' },
    hospital: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', accent: 'British, Calm' },
    bank:     { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel',  accent: 'British, Professional' },
    school:   { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily',    accent: 'British, Friendly' },
    supermarket: { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', accent: 'American, Casual' },
    police:   { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold',  accent: 'American, Authoritative' },
  },
  zh: {
    // ElevenLabs eleven_multilingual_v2 handles Mandarin well
    airport:    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah',    accent: 'Mandarin' },
    hospital:   { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', accent: 'Mandarin' },
    bank:       { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel',   accent: 'Mandarin' },
    school:     { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily',     accent: 'Mandarin' },
    supermarket:{ id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',     accent: 'Mandarin' },
    police:     { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold',   accent: 'Mandarin' },
  },
};

function getVoiceId(scenario, language) {
  const langKey = language === 'zh' ? 'zh' : 'en';
  return (VOICES[langKey][scenario] || VOICES[langKey].airport).id;
}

function getVoiceInfo(scenario, language) {
  const langKey = language === 'zh' ? 'zh' : 'en';
  return VOICES[langKey][scenario] || VOICES[langKey].airport;
}

module.exports = { getVoiceId, getVoiceInfo };
