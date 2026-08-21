/**
 * Stop the Slop — Cloudflare Worker API
 *
 * Endpoints:
 *   POST /api/analyze  — Analyze text for AI-generated content (receives transcript from extension)
 *   GET  /api/check?videoId=<id> — Check if a video has been analyzed (cache lookup)
 *   GET  /api/health   — Health check
 *
 * Environment bindings:
 *   DB             — D1 database for caching results
 *   SAPLING_API_KEY — Sapling AI API key (set via wrangler secret)
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
 * Analyze a transcript: call Sapling AI and cache the result.
 */
async function analyzeTranscript(videoId, transcript, env) {
  // Check cache first
  const cached = await checkCache(videoId, env);
  if (cached.found) return cached;

  // Truncate to 50K chars to stay within Sapling limits and save quota
  const textToAnalyze = transcript.slice(0, 50000);

  // Call Sapling AI Detection API
  const detection = await detectAI(textToAnalyze, env.SAPLING_API_KEY);

  // Prepare sentence scores (sorted by score descending)
  const sentenceScores = (detection.sentence_scores || [])
    .map((s) => ({ sentence: s.sentence, score: s.score }))
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
 * Call Sapling AI Detection API.
 */
async function detectAI(text, apiKey) {
  const response = await fetch('https://api.sapling.ai/api/v1/aidetect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: apiKey,
      text,
      sent_scores: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Sapling API error:', response.status, errorText);
    const err = new Error(`AI detection failed: ${response.status}`);
    err.status = 502;
    throw err;
  }

  return await response.json();
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
