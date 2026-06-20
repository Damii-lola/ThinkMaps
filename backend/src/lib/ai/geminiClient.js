// Gemini handles the "research" side: synthesizing Reddit/Hacker News/App Store
// signal into sourced ideas, and scoring each idea across the 10x10 framework.
//
// NOTE: confirm the current free-tier model name in Google AI Studio before going
// live - "gemini-2.0-flash" is the placeholder used here.

const GEMINI_MODEL = 'gemini-2.0-flash';

function buildUrl(apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

/**
 * @param {string} prompt
 * @param {{ json?: boolean }} [options]
 */
export async function callGemini(prompt, options = {}) {
  const { GEMINI_API_KEY } = process.env;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(options.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  };

  const res = await fetch(buildUrl(GEMINI_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
