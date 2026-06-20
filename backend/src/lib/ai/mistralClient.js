// Mistral handles the "graph mechanics" side: generating niche/sub-niche/audience
// option groups, Retry, Random, and Smart Suggestion tooltips.
//
// NOTE: confirm the current free-tier model name in your Mistral console before
// going live - "mistral-small-latest" is the placeholder used here.

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-latest';

/**
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
 * @param {{ json?: boolean }} [options]
 */
export async function callMistral(messages, options = {}) {
  const { MISTRAL_API_KEY } = process.env;
  if (!MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY is not set');
  }

  const body = {
    model: MISTRAL_MODEL,
    messages,
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mistral request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}
