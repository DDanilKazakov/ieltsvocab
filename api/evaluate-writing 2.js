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

const schema = {
  type: 'OBJECT',
  properties: {
    practice_band: { type: 'NUMBER' },
    band_note: { type: 'STRING' },
    task_achievement: {
      type: 'OBJECT',
      properties: { band: { type: 'NUMBER' }, feedback: { type: 'STRING' } },
      required: ['band', 'feedback'],
    },
    coherence_cohesion: {
      type: 'OBJECT',
      properties: { band: { type: 'NUMBER' }, feedback: { type: 'STRING' } },
      required: ['band', 'feedback'],
    },
    lexical_resource: {
      type: 'OBJECT',
      properties: { band: { type: 'NUMBER' }, feedback: { type: 'STRING' } },
      required: ['band', 'feedback'],
    },
    grammar_accuracy: {
      type: 'OBJECT',
      properties: { band: { type: 'NUMBER' }, feedback: { type: 'STRING' } },
      required: ['band', 'feedback'],
    },
    factual_accuracy: {
      type: 'OBJECT',
      properties: {
        verdict: {
          type: 'STRING',
          enum: ['accurate', 'minor_issues', 'major_issues', 'not_verifiable'],
        },
        feedback: { type: 'STRING' },
        issues: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['verdict', 'feedback', 'issues'],
    },
    speed: {
      type: 'OBJECT',
      properties: {
        verdict: {
          type: 'STRING',
          enum: ['on_target', 'slightly_over', 'far_over', 'not_timed'],
        },
        feedback: { type: 'STRING' },
      },
      required: ['verdict', 'feedback'],
    },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
    corrections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          original: { type: 'STRING' },
          improved: { type: 'STRING' },
          explanation: { type: 'STRING' },
        },
        required: ['original', 'improved', 'explanation'],
      },
    },
    missing_features: { type: 'ARRAY', items: { type: 'STRING' } },
    band8_rewrite: { type: 'STRING' },
    next_focus: { type: 'STRING' },
  },
  required: [
    'practice_band', 'band_note', 'task_achievement', 'coherence_cohesion',
    'lexical_resource', 'grammar_accuracy', 'factual_accuracy', 'speed',
    'strengths', 'corrections', 'missing_features', 'band8_rewrite', 'next_focus',
  ],
};

function parseDataUrl(url) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function imageToInlineData(imageUrl) {
  if (!imageUrl) return null;

  if (imageUrl.startsWith('data:image/')) {
    return parseDataUrl(imageUrl);
  }

  if (!/^https:\/\//i.test(imageUrl)) return null;

  // Writing Lab images are expected to be stored in this Supabase project.
  // Restrict remote fetching to the project's own Supabase domain.
  const u = new URL(imageUrl);
  if (u.hostname !== 'vykorjlnmxkekqkzyfnk.supabase.co') {
    throw new Error('Unsupported image host. Please upload the chart through Writing Lab.');
  }

  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`Could not load chart image (${r.status}).`);

  const mimeType = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!mimeType.startsWith('image/')) throw new Error('The task image is not a supported image file.');

  const bytes = Buffer.from(await r.arrayBuffer());
  // Keep the request comfortably below serverless/API payload limits.
  if (bytes.length > 8 * 1024 * 1024) {
    throw new Error('Chart image is too large. Please upload an image under 8 MB.');
  }

  return { mimeType, data: bytes.toString('base64') };
}

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

  // Recommended Vercel variable name: GEMINI_API_KEY.
  // Fallback keeps things working if you temporarily saved the Gemini key as OPENAI_API_KEY.
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return send(res, 500, { error: 'GEMINI_API_KEY is not configured in Vercel.' });
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

  const coachInstructions = `You are a rigorous IELTS Academic Writing Task 1 coach.
Evaluate ONLY the requested training mode. If the user wrote only an introduction, overview, plan, or one body paragraph, do NOT penalize them for missing other sections. The practice_band is a drill-level estimate based only on the evidence available, not an official full IELTS Writing score.

Use the chart image as the primary source of truth for data, trends, categories, dates, and comparisons. If teacher / answer-key notes are supplied, use them as an additional source of truth. Never invent a figure or trend that is not visible or supplied. If there is no usable chart image or reference note, set factual_accuracy.verdict to "not_verifiable" and explain the limitation.

Assess with IELTS-style dimensions: Task Achievement, Coherence & Cohesion, Lexical Resource, and Grammatical Range & Accuracy. Keep feedback practical and concise. Prioritize mistakes that materially affect score or speed. For corrections, quote only short problematic phrases, not the entire answer. Give at most 5 corrections and at most 4 missing/weak features.

For the Band 8 reference:
- preserve the candidate's meaning where possible;
- produce only the section requested by the training mode;
- do not write a full Task 1 if the mode is partial;
- for Planning mode, provide an ideal compact plan rather than prose;
- use accurate comparisons and natural IELTS wording without overcomplicated vocabulary.

Timing:
- elapsed = 0 means the timer was not used -> not_timed;
- at or under target -> on_target;
- up to 25% over target -> slightly_over;
- more than 25% over target -> far_over.

Band values should normally use IELTS half-band increments from 4.0 to 9.0.`;

  const parts = [];
  const imageUrl = clampText(task.image_url, 5000).trim();

  try {
    const image = await imageToInlineData(imageUrl);
    if (image) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
  } catch (err) {
    return send(res, 400, { error: err?.message || String(err) });
  }

  parts.push({
    text: `${coachInstructions}\n\n--- TASK TO EVALUATE ---\n${taskText}`,
  });

  const model = process.env.GEMINI_WRITING_MODEL || 'gemini-3.8-flash';

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            maxOutputTokens: 2200,
          },
        }),
      },
    );

    const requestId =
      geminiRes.headers.get('x-goog-request-id') ||
      geminiRes.headers.get('x-request-id') ||
      '';
    const data = await geminiRes.json().catch(() => ({}));

    if (!geminiRes.ok) {
      const msg = data?.error?.message || `Gemini request failed (${geminiRes.status}).`;
      return send(res, 502, { error: msg, request_id: requestId });
    }

    const raw = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();

    if (!raw) {
      const reason = data?.candidates?.[0]?.finishReason || '';
      return send(res, 502, {
        error: reason ? `Gemini returned no feedback (${reason}).` : 'Gemini returned no feedback.',
        request_id: requestId,
      });
    }

    let feedback;
    try {
      feedback = JSON.parse(raw);
    } catch {
      return send(res, 502, { error: 'Could not parse Gemini feedback.', request_id: requestId });
    }

    return send(res, 200, { feedback, model, request_id: requestId });
  } catch (err) {
    return send(res, 500, { error: err?.message || String(err) });
  }
};
