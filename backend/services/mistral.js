const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

async function callMistral(messages, { temperature = 0.8 } = {}) {
  if (!process.env.MISTRAL_API_KEY) {
    throw new Error('Missing MISTRAL_API_KEY env var.');
  }

  const res = await fetch(MISTRAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mistral API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Mistral returned no content.');

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Mistral returned malformed JSON.');
  }
}

const GROUP_PROMPTS = {
  niche: 'a starting niche for a mobile/web app idea (e.g. Fitness, Finance & Commerce, Productivity, Entertainment)',
  sub_niche: 'a more specific sub-niche within the chosen niche',
  audience: 'a specific, narrow target audience segment for this path',
  monetization: 'a realistic monetization model for this path',
};

export async function generateGroupOptions({ groupType, pathContext, excludeLabels = [] }) {
  const description = GROUP_PROMPTS[groupType] || groupType;

  const messages = [
    {
      role: 'system',
      content:
        'You generate concise option lists for a visual app-idea brainstorming graph called ThinkMaps. ' +
        'Always respond with strict JSON: {"options": ["...", "...", ...]}. ' +
        'Return between 4 and 6 short options (2-5 words each, title case, no numbering). ' +
        'Never repeat anything in the excluded list.',
    },
    {
      role: 'user',
      content:
        `Path so far: ${pathContext.length ? pathContext.join(' -> ') : '(start of graph)'}\n` +
        `Generate options for: ${description}.\n` +
        `Exclude: ${excludeLabels.length ? excludeLabels.join(', ') : 'none'}.`,
    },
  ];

  const json = await callMistral(messages, { temperature: 0.9 });
  const options = Array.isArray(json.options) ? json.options.slice(0, 6) : [];
  if (!options.length) throw new Error('Mistral returned no options.');
  return options;
}

export async function generateInsight({ pathContext }) {
  if (!pathContext.length) return null;

  const messages = [
    {
      role: 'system',
      content:
        'You write one short, specific "insight bubble" (max 22 words) for an app-idea brainstorming tool, ' +
        'naming a real pattern or pain point builders should consider for the given path. ' +
        'Respond with strict JSON: {"insight": "..."}',
    },
    { role: 'user', content: `Path: ${pathContext.join(' -> ')}` },
  ];

  const json = await callMistral(messages, { temperature: 0.7 });
  return json.insight || null;
}
