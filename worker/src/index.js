/**
 * Stop the Slop — Cloudflare Worker API
 *
 * Endpoints:
 *   POST /api/analyze  — Analyze text for AI-generated content (receives transcript from extension)
 *   GET  /api/check?videoId=<id> — Check if a video has been analyzed (cache lookup)
 *   GET  /api/check-batch — Check multiple video IDs at once
 *   GET  /api/health   — Health check
 *
 * Environment bindings:
 *   DB              — D1 database for caching results
 *   GEMINI_API_KEY  — Google Gemini API key (primary AI detection engine)
 *   SAPLING_API_KEY — Sapling AI API key (optional fallback)
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/health') {
        return json({ status: 'ok', timestamp: new Date().toISOString() }, corsHeaders);
      }

      if (url.pathname === '/api/check' && request.method === 'GET') {
        const videoId = url.searchParams.get('videoId');
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return json({ error: 'Invalid or missing videoId' }, corsHeaders, 400);
        }
        const result = await checkCache(videoId, env);
        return json(result, corsHeaders);
      }

      if (url.pathname === '/api/check-batch') {
        let videoIds = [];
        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          videoIds = Array.isArray(body.videoIds) ? body.videoIds : [];
        } else if (request.method === 'GET') {
          const idsParam = url.searchParams.get('ids') || url.searchParams.get('videoIds') || '';
          videoIds = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
        }
        const result = await checkCacheBatch(videoIds, env);
        return json(result, corsHeaders);
      }

      if (url.pathname === '/api/analyze' && request.method === 'POST') {
        const body = await request.json();
        const { videoId, transcript } = body;

        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return json({ error: 'Invalid or missing videoId' }, corsHeaders, 400);
        }
        if (!transcript || typeof transcript !== 'string' || transcript.length < 50) {
          return json({ error: 'Transcript too short or missing (min 50 chars)' }, corsHeaders, 422);
        }

        const result = await analyzeTranscript(videoId, transcript, env);
        return json(result, corsHeaders);
      }

      return json({ error: 'Not found' }, corsHeaders, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return json(
        { error: err.message || 'Internal server error' },
        corsHeaders,
        err.status || 500
      );
    }
  },
};

/**
 * Check if we have a cached result for a video.
 */
async function checkCache(videoId, env) {
  const cached = await env.DB.prepare(
    'SELECT * FROM video_analyses WHERE video_id = ?'
  )
    .bind(videoId)
    .first();

  if (cached) {
    return {
      videoId: cached.video_id,
      score: cached.overall_score,
      sentenceScores: JSON.parse(cached.sentence_scores || '[]'),
      transcriptLength: cached.transcript_length,
      transcriptPreview: cached.transcript_preview,
      analyzedAt: cached.analyzed_at,
      cached: true,
      found: true,
    };
  }

  return { found: false, videoId };
}

/**
 * Batch check cached results for multiple video IDs (up to 50 at once).
 */
async function checkCacheBatch(videoIds, env) {
  if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
    return { cached: {} };
  }

  const validIds = [...new Set(videoIds.filter((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id)))].slice(0, 50);

  if (validIds.length === 0) {
    return { cached: {} };
  }

  const placeholders = validIds.map(() => '?').join(',');
  const query = `SELECT video_id, overall_score, analyzed_at FROM video_analyses WHERE video_id IN (${placeholders})`;

  const { results } = await env.DB.prepare(query)
    .bind(...validIds)
    .all();

  const cachedMap = {};
  if (results && Array.isArray(results)) {
    for (const row of results) {
      cachedMap[row.video_id] = {
        videoId: row.video_id,
        score: row.overall_score,
        analyzedAt: row.analyzed_at,
        cached: true,
        found: true,
      };
    }
  }

  return { cached: cachedMap };
}

/**
 * Analyze a transcript: call Gemini AI (with fallback to Sapling if configured) and cache the result.
 */
async function analyzeTranscript(videoId, transcript, env) {
  // Check cache first
  const cached = await checkCache(videoId, env);
  if (cached.found) return cached;

  // Take up to 15,000 characters (~3,000 words) for fast, highly accurate analysis
  const textToAnalyze = transcript.slice(0, 15000);

  let detection = null;
  const geminiKey = env.GEMINI_API_KEY;
  const saplingKey = env.SAPLING_API_KEY;

  if (geminiKey) {
    try {
      detection = await detectAIWithGemini(textToAnalyze, geminiKey);
    } catch (geminiErr) {
      console.warn('[Stop the Slop] Gemini detection failed:', geminiErr);
      if (saplingKey) {
        console.log('[Stop the Slop] Falling back to Sapling API...');
        detection = await detectAIWithSapling(textToAnalyze, saplingKey);
      } else {
        throw geminiErr;
      }
    }
  } else if (saplingKey) {
    detection = await detectAIWithSapling(textToAnalyze, saplingKey);
  } else {
    throw new Error('No AI detection API key configured on server. Set GEMINI_API_KEY in worker environment.');
  }

  // Ensure sentence scores are sorted by AI score descending
  const sentenceScores = (detection.sentenceScores || [])
    .filter((s) => s && typeof s.sentence === 'string' && typeof s.score === 'number')
    .sort((a, b) => b.score - a.score);

  // Cache result in D1
  await env.DB.prepare(
    `INSERT OR REPLACE INTO video_analyses
       (video_id, overall_score, sentence_scores, transcript_length, transcript_preview, analyzed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      videoId,
      detection.score,
      JSON.stringify(sentenceScores),
      transcript.length,
      transcript.slice(0, 200)
    )
    .run();

  return {
    videoId,
    score: detection.score,
    sentenceScores,
    transcriptLength: transcript.length,
    transcriptPreview: transcript.slice(0, 200),
    analyzedAt: new Date().toISOString(),
    cached: false,
    found: true,
  };
}

/**
 * Call Gemini Flash API for structured YouTube transcript analysis
 */
async function detectAIWithGemini(text, apiKey, retries = 2) {
  const model = 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const systemPrompt = `You are a specialized AI script detector for YouTube video transcripts.
Analyze whether the transcript was generated by an AI language model (ChatGPT, Claude, Gemini, etc.) or naturally spoken/written by a human creator.

Key AI Slop Signals:
- Generic, robotic video intro/outro ("In today's video we will explore...", "Have you ever wondered...", "In conclusion...", "Let's dive right in")
- Formulaic transitions ("Furthermore", "Moreover", "Additionally", "It is important to remember")
- Uniform cadence and rhythm, shallow Wikipedia-style facts without personal depth or authentic anecdotes
- Repetitive listicle structures and cliché metaphors

Key Human Signals:
- Natural conversational flow, colloquial speech, casual humor, spontaneous tangents
- Personal anecdotes, distinct opinions, specialized hands-on expertise
- Authentic spoken cadence with natural variety

Respond ONLY with a JSON object matching this schema:
{
  "score": <float between 0.0 (100% human) and 1.0 (100% AI)>,
  "sentenceScores": [
    { "sentence": "<exact sentence or key excerpt from text>", "score": <float between 0.0 and 1.0> }
  ]
}`;

  const prompt = `Analyze this YouTube transcript for AI-generated slop:\n"""\n${text}\n"""`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      });

      if (response.status === 429) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
          continue;
        }
        const err = new Error('AI detection service is currently rate limited. Please try again shortly.');
        err.status = 429;
        throw err;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('Gemini API HTTP Error:', response.status, errText);
        const err = new Error(`AI detector error (${response.status})`);
        err.status = response.status >= 500 ? 502 : response.status;
        throw err;
      }

      const data = await response.json();
      const rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawOutput) {
        throw new Error('Empty response received from Gemini detector');
      }

      // Clean markdown fences if present
      const cleanJson = rawOutput.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      const score = typeof parsed.score === 'number'
        ? Math.max(0, Math.min(1, parsed.score))
        : 0.5;

      const sentenceScores = Array.isArray(parsed.sentenceScores)
        ? parsed.sentenceScores.map((s) => ({
            sentence: String(s.sentence || '').trim(),
            score: typeof s.score === 'number' ? Math.max(0, Math.min(1, s.score)) : score,
          })).filter((s) => s.sentence.length > 0)
        : [];

      return {
        score,
        sentenceScores,
      };
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * Fallback: Call Sapling AI Detection API with automatic backoff retry on 429
 */
async function detectAIWithSapling(text, apiKey, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch('https://api.sapling.ai/api/v1/aidetect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: apiKey,
          text,
          sent_scores: true,
        }),
      });

      if (response.status === 429) {
        if (attempt < retries) {
          console.log(`Sapling 429 rate limit. Retrying in ${(attempt + 1) * 1200}ms...`);
          await new Promise((r) => setTimeout(r, (attempt + 1) * 1200));
          continue;
        }
        const err = new Error('AI detector is currently rate-limited. Please wait 10-15 seconds and try again.');
        err.status = 429;
        throw err;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Sapling API error:', response.status, errorText);
        const err = new Error(`AI detection service error (${response.status})`);
        err.status = response.status >= 500 ? 502 : response.status;
        throw err;
      }

      const data = await response.json();
      return {
        score: typeof data.score === 'number' ? data.score : 0.5,
        sentenceScores: (data.sentence_scores || []).map((s) => ({
          sentence: s.sentence,
          score: s.score,
        })),
      };
    } catch (e) {
      if (attempt >= retries) throw e;
    }
  }
}

/**
 * JSON response helper.
 */
function json(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

