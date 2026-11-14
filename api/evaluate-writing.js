const SUPABASE_URL = 'https://vykorjlnmxkekqkzyfnk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_K51m0vo6t0O9ZdruwdGL6g_HWvRLz0C';

function send(res, status, body) {
  res.status(status).json(body);
}

function clampText(value, max) {
  return String(value ?? '').slice(0, max);
}

async function verifySupabaseUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!r.ok) return null;
  return r.json();
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    practice_band: { type: 'number' },
    band_note: { type: 'string' },
    task_achievement: {
      type: 'object', additionalProperties: false,
      properties: { band: { type: 'number' }, feedback: { type: 'string' } },
      required: ['band', 'feedback'],
    },
    coherence_cohesion: {
      type: 'object', additionalProperties: false,
      properties: { band: { type: 'number' }, feedback: { type: 'string' } },
      required: ['band', 'feedback'],
    },
    lexical_resource: {
      type: 'object', additionalProperties: false,
      properties: { band: { type: 'number' }, feedback: { type: 'string' } },
      required: ['band', 'feedback'],
    },
    grammar_accuracy: {
      type: 'object', additionalProperties: false,
      properties: { band: { type: 'number' }, feedback: { type: 'string' } },
      required: ['band', 'feedback'],
    },
    factual_accuracy: {
      type: 'object', additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['accurate', 'minor_issues', 'major_issues', 'not_verifiable'] },
        feedback: { type: 'string' },
        issues: { type: 'array', items: { type: 'string' } },
      },
      required: ['verdict', 'feedback', 'issues'],
    },
    speed: {
      type: 'object', additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['on_target', 'slightly_over', 'far_over', 'not_timed'] },
        feedback: { type: 'string' },
      },
      required: ['verdict', 'feedback'],
    },
    strengths: { type: 'array', items: { type: 'string' } },
    corrections: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          original: { type: 'string' },
          improved: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['original', 'improved', 'explanation'],
      },
    },
    missing_features: { type: 'array', items: { type: 'string' } },
    band8_rewrite: { type: 'string' },
    next_focus: { type: 'string' },
  },
  required: [
    'practice_band', 'band_note', 'task_achievement', 'coherence_cohesion',
    'lexical_resource', 'grammar_accuracy', 'factual_accuracy', 'speed',
    'strengths', 'corrections', 'missing_features', 'band8_rewrite', 'next_focus'
  ],
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return send(res, 401, { error: 'Sign in to the app before using the AI checker.' });

  const user = await verifySupabaseUser(token).catch(() => null);
  if (!user?.id) return send(res, 401, { error: 'Your cloud session is invalid or expired.' });

  if (!process.env.OPENAI_API_KEY) {
    return send(res, 500, { error: 'OPENAI_API_KEY is not configured in Vercel.' });
  }

  const body = req.body || {};
  const task = body.task || {};
  const answer = clampText(body.answer_text, 9000).trim();
  if (!answer) return send(res, 400, { error: 'Answer text is required.' });

  const mode = clampText(body.mode, 40);
  const modeLabel = clampText(body.mode_label, 120);
  const modeHint = clampText(body.mode_hint, 180);
  const elapsed = Math.max(0, Number(body.elapsed_seconds) || 0);
  const target = Math.max(0, Number(body.target_seconds) || 0);

  const taskText = [
    `Task type: ${clampText(task.task_type, 50)}`,
    `Task title: ${clampText(task.title, 300)}`,
    `IELTS prompt: ${clampText(task.prompt, 3000)}`,
    task.source_note ? `Source note: ${clampText(task.source_note, 500)}` : '',
    task.reference_notes ? `Teacher / answer-key notes: ${clampText(task.reference_notes, 4000)}` : '',
    `Training mode: ${modeLabel || mode}`,
    modeHint ? `Mode goal: ${modeHint}` : '',
    `Time: ${elapsed || 0} seconds; target: ${target || 0} seconds`,
    '',
    'Candidate answer:',
    answer,
  ].filter(Boolean).join('\n');

  const developer = `You are a rigorous IELTS Academic Writing Task 1 coach.
Evaluate ONLY the requested training mode. If the user wrote only an introduction, overview, plan, or one body paragraph, do NOT penalize them for missing other sections. The "practice_band" is a drill-level estimate based only on the evidence available, not an official full IELTS Writing score.

Use the chart image as the primary source of truth for data, trends, categories, dates, and comparisons. If teacher / answer-key notes are supplied, use them as an additional source of truth. Never invent a figure or trend that is not visible or supplied. If there is no usable chart image or reference note, set factual_accuracy.verdict to "not_verifiable" and explain the limitation.

Assess with IELTS-style dimensions: Task Achievement, Coherence & Cohesion, Lexical Resource, and Grammatical Range & Accuracy. Keep the feedback practical and concise. Prioritize mistakes that materially affect the score or speed. For corrections, quote only short problematic phrases, not the entire answer. Give at most 5 corrections and at most 4 missing/weak features.

For the Band 8 reference:
- preserve the candidate's meaning where possible;
- produce only the section requested by the training mode;
- do not write a full Task 1 if the mode is partial;
- for Planning mode, provide an ideal compact plan rather than prose;
- use accurate comparisons and natural IELTS wording, without overcomplicated vocabulary.

Timing:
- elapsed = 0 means the timer was not used → "not_timed";
- at or under target → "on_target";
- up to 25% over target → "slightly_over";
- more than 25% over target → "far_over".

Band values should normally use IELTS half-band increments from 4.0 to 9.0.`;

  const content = [{ type: 'input_text', text: taskText }];
  const imageUrl = clampText(task.image_url, 5000).trim();
  if (/^https?:\/\//i.test(imageUrl) || /^data:image\//i.test(imageUrl)) {
    content.push({ type: 'input_image', image_url: imageUrl, detail: 'high' });
  }

  const model = process.env.OPENAI_WRITING_MODEL || 'gpt-6.1-terra';

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        instructions: developer,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'ielts_task1_feedback',
            strict: true,
            schema,
          },
        },
        max_output_tokens: 2200,
      }),
    });

    const requestId = openaiRes.headers.get('x-request-id') || '';
    const data = await openaiRes.json().catch(() => ({}));

    if (!openaiRes.ok) {
      const msg = data?.error?.message || `OpenAI request failed (${openaiRes.status}).`;
      return send(res, 502, { error: msg, request_id: requestId });
    }

    const raw = extractOutputText(data);
    if (!raw) return send(res, 502, { error: 'The AI returned no feedback.', request_id: requestId });

    let feedback;
    try {
      feedback = JSON.parse(raw);
    } catch {
      return send(res, 502, { error: 'Could not parse the AI feedback.', request_id: requestId });
    }

    return send(res, 200, { feedback, model, request_id: requestId });
  } catch (err) {
    return send(res, 500, { error: err?.message || String(err) });
  }
};
