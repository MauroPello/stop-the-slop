/**
 * Stop the Slop: Cloudflare Worker API
 *
 * Endpoints:
 *   POST /api/analyze: Analyze text for AI-generated content (receives transcript from extension)
 *   GET  /api/check?videoId=<id>: Check if a video has been analyzed (cache lookup)
 *   GET  /api/check-batch: Check multiple video IDs at once
 *   GET  /api/health: Health check
 *
 * Environment bindings:
 *   DB: D1 database for caching results
 *   GEMINI_API_KEY: Google Gemini API key (primary AI detection engine)
 *   SAPLING_API_KEY: Sapling AI API key (optional fallback)
 */

// In-memory sliding rate limiter per isolate (fast, 0-cost protection against floods)
const memoryRateLimits = new Map();

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Retry-After',
      'Access-Control-Expose-Headers': 'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
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
        // Rate limit cache checks (300 req / min per IP)
        const rateLimitRes = await enforceRateLimit(
          env,
          request,
          'check',
          300,
          60,
          corsHeaders,
          'Too many video status checks. Please slow down.'
        );
        if (rateLimitRes) return rateLimitRes;

        const videoId = url.searchParams.get('videoId');
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return json({ error: 'Invalid or missing videoId' }, corsHeaders, 400);
        }
        const result = await checkCache(videoId, env);
        return json(result, corsHeaders);
      }

      if (url.pathname === '/api/check-batch') {
        // Rate limit batch checks (240 req / min per IP)
        const rateLimitRes = await enforceRateLimit(
          env,
          request,
          'check_batch',
          240,
          60,
          corsHeaders,
          'Too many batch checks. Please wait a moment.'
        );
        if (rateLimitRes) return rateLimitRes;

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
        const body = await request.json().catch(() => ({}));
        const { videoId, transcript } = body;

        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return json({ error: 'Invalid or missing videoId' }, corsHeaders, 400);
        }
        if (!transcript || typeof transcript !== 'string' || transcript.length < 50) {
          return json({ error: 'Transcript too short or missing (min 50 chars)' }, corsHeaders, 422);
        }

        console.log('[Stop the Slop] Analysis request', {
          videoId,
          transcriptLength: transcript.length,
        });

        // 1. Check cache first (0 cost if already analyzed)
        const cached = await checkCache(videoId, env);
        if (cached.found) {
          console.log('[Stop the Slop] Analysis cache hit', {
            videoId,
            analyzedAt: cached.analyzedAt,
          });
          return json(cached, corsHeaders);
        }

        // 2. Rate limits on AI detections
        // - 30 analyses per minute per IP
        const minuteLimitRes = await enforceRateLimit(
          env,
          request,
          'analyze_min',
          30,
          60,
          corsHeaders,
          'Rate limit exceeded (max 30 analyses/min). Please wait a moment before analyzing more videos.'
        );
        if (minuteLimitRes) return minuteLimitRes;

        // - 300 analyses per hour per IP
        const hourLimitRes = await enforceRateLimit(
          env,
          request,
          'analyze_hr',
          300,
          3600,
          corsHeaders,
          'Hourly rate limit exceeded (max 300 analyses/hr). Please try again later.'
        );
        if (hourLimitRes) return hourLimitRes;

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
 * Extract client IP address from request headers.
 */
function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

/**
 * Layer 1: In-memory sliding window rate limiter per isolate.
 */
function checkMemoryRateLimit(ip, action, limit, windowSecs) {
  const now = Math.floor(Date.now() / 1000);
  const key = `${ip}:${action}`;

  // Periodic lazy cleanup of expired entries
  if (memoryRateLimits.size > 1500) {
    for (const [k, v] of memoryRateLimits.entries()) {
      if (v.resetAt <= now) memoryRateLimits.delete(k);
    }
  }

  const entry = memoryRateLimits.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryRateLimits.set(key, { count: 1, resetAt: now + windowSecs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowSecs };
  }

  if (entry.count >= limit) {
    const retryAfter = Math.max(1, entry.resetAt - now);
    return { allowed: false, remaining: 0, resetAt: entry.resetAt, retryAfter };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Layer 2: Persistent D1 rate limiter across all global Cloudflare edge isolates.
 */
async function checkD1RateLimit(env, ip, action, limit, windowSecs) {
  if (!env.DB) return { allowed: true, remaining: limit, resetAt: 0 };

  const now = Math.floor(Date.now() / 1000);
  const key = `rl:${ip}:${action}`;

  try {
    const row = await env.DB.prepare(
      'SELECT count, reset_at FROM rate_limits WHERE key = ?'
    )
      .bind(key)
      .first();

    if (!row || row.reset_at <= now) {
      await env.DB.prepare(
        `INSERT INTO rate_limits (key, count, reset_at)
         VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = ?`
      )
        .bind(key, now + windowSecs, now + windowSecs)
        .run();
      return { allowed: true, remaining: limit - 1, resetAt: now + windowSecs };
    }

    if (row.count >= limit) {
      const retryAfter = Math.max(1, row.reset_at - now);
      return { allowed: false, remaining: 0, resetAt: row.reset_at, retryAfter };
    }

    await env.DB.prepare(
      'UPDATE rate_limits SET count = count + 1 WHERE key = ?'
    )
      .bind(key)
      .run();

    return {
      allowed: true,
      remaining: Math.max(0, limit - (row.count + 1)),
      resetAt: row.reset_at,
    };
  } catch (err) {
    console.warn('[Stop the Slop] D1 rate limit check error:', err);
    try {
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)'
      ).run();
    } catch (_) {}
    return { allowed: true, remaining: limit, resetAt: now + windowSecs };
  }
}

/**
 * Enforce multi-layer rate limits and return 429 Response if exceeded.
 */
async function enforceRateLimit(env, request, action, limit, windowSecs, corsHeaders, customMsg) {
  const ip = getClientIp(request);

  // 1. Fast in-memory check (catches rapid-fire bursts with 0 DB overhead)
  const memResult = checkMemoryRateLimit(ip, action, limit, windowSecs);
  if (!memResult.allowed) {
    const retryAfter = memResult.retryAfter || 30;
    return rateLimitResponse(retryAfter, limit, memResult.resetAt, corsHeaders, customMsg);
  }

  // 2. Persistent D1 check (coordinates across all global edge nodes)
  const d1Result = await checkD1RateLimit(env, ip, action, limit, windowSecs);
  if (!d1Result.allowed) {
    const retryAfter = d1Result.retryAfter || 30;
    return rateLimitResponse(retryAfter, limit, d1Result.resetAt, corsHeaders, customMsg);
  }

  return null;
}

/**
 * Create a standardized 429 Too Many Requests response.
 */
function rateLimitResponse(retryAfter, limit, resetAt, corsHeaders, customMsg) {
  const message =
    customMsg ||
    `Rate limit exceeded. Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before trying again.`;

  return new Response(
    JSON.stringify({
      error: message,
      code: 'RATE_LIMITED',
      retryAfter,
      limit,
      resetAt,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(resetAt),
        ...corsHeaders,
      },
    }
  );
}


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
 * Analyze a transcript: call AI engine (TypeSafe Jev with fallback to Gemini/Sapling) and cache the result.
 */
async function analyzeTranscript(videoId, transcript, env) {
  // Check cache first
  const cached = await checkCache(videoId, env);
  if (cached.found) {
    console.log('[Stop the Slop] Analysis cache hit', { videoId, analyzedAt: cached.analyzedAt });
    return cached;
  }

  // Take up to 15,000 characters (~3,000 words) for fast, highly accurate analysis
  const textToAnalyze = transcript.slice(0, 15000);

  let overallScore = 0.5;
  let sentenceScores = [];
  let activeEngine = 'typesafe-ai/jev';

  console.log('[Stop the Slop] Analysis cache miss', {
    videoId,
    transcriptLength: transcript.length,
    analyzedCharacters: textToAnalyze.length,
  });

  const geminiKey = env.GEMINI_API_KEY;

  try {
    const jevRes = await detectAIWithJev(textToAnalyze, env);
    overallScore = jevRes.score;
    activeEngine = jevRes.model || 'typesafe-ai/jev';
  } catch (jevErr) {
    console.warn('[Stop the Slop] Jev detection failed, attempting fallback to Gemini:', jevErr.message);
    if (geminiKey) {
      try {
        overallScore = await detectAIWithGemini(textToAnalyze, geminiKey);
        activeEngine = 'gemini-3.6-flash (fallback)';
      } catch (geminiErr) {
        console.warn('[Stop the Slop] Gemini detection fallback failed:', geminiErr);
        if (env.SAPLING_API_KEY) {
          const saplingRes = await detectAIWithSapling(textToAnalyze, env.SAPLING_API_KEY);
          overallScore = saplingRes.score;
          activeEngine = 'sapling (fallback)';
        } else {
          throw geminiErr;
        }
      }
    } else if (env.SAPLING_API_KEY) {
      const saplingRes = await detectAIWithSapling(textToAnalyze, env.SAPLING_API_KEY);
      overallScore = saplingRes.score;
      activeEngine = 'sapling (fallback)';
    } else {
      throw jevErr;
    }
  }

  console.log('[Stop the Slop] Analysis provider selected', {
    videoId,
    engine: activeEngine,
    score: overallScore,
  });

  // Cache result in D1
  await env.DB.prepare(
    `INSERT OR REPLACE INTO video_analyses
       (video_id, overall_score, sentence_scores, analyzed_at)
     VALUES (?, ?, ?, datetime('now'))`
  )
    .bind(
      videoId,
      overallScore,
      JSON.stringify(sentenceScores)
    )
    .run()
    .catch((dbErr) => console.warn('[Stop the Slop] DB cache write error:', dbErr));

  return {
    videoId,
    score: overallScore,
    engine: activeEngine,
    sentenceScores,
    analyzedAt: new Date().toISOString(),
    cached: false,
    found: true,
  };
}

/**
 * Call TypeSafe Jev model directly via TypeSafe AI API (https://api.typesafe.ai/v1/systemone)
 * Uses native 'choice' primitive to evaluate AI slop probability and confidence.
 */
async function detectAIWithJev(text, env) {
  const promptState = text.slice(0, 15000);
  const typesafeKey = env.TYPESAFE_API_KEY || env.TYPESAFE_AI_KEY || env.JEV_API_KEY;

  if (!typesafeKey) {
    throw new Error('TYPESAFE_API_KEY is not configured for Jev.');
  }

  let response;
  for (let attempt = 1; attempt <= 2; attempt++) {
    response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${typesafeKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'jev-latest',
        state: promptState,
        questions: {
          is_ai: {
            type: 'choice',
            instructions: 'Is it AI-generated, yes or no?',
            criteria: {
              yes: 'Yes, it is AI-generated',
              no: 'No, it is not AI-generated',
            },
          },
        },
      }),
    });

    if (response.status === 429 && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    break;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let msg = `TypeSafe Jev API error (${response.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.detail?.message) {
        msg = parsed.detail.message;
      } else if (typeof parsed.detail === 'string') {
        msg = parsed.detail;
      } else if (parsed.error?.message) {
        msg = parsed.error.message;
      } else if (parsed.message) {
        msg = parsed.message;
      }
    } catch {
      if (errText) msg += `: ${errText.slice(0, 180)}`;
    }
    throw new Error(msg);
  }

  const data = await response.json();
  const ans = data.answers?.is_ai;
  const isYes = ans?.choice === 'yes';
  const isNo = ans?.choice === 'no';
  const rawConfidence = ans?.confidence;
  const probYes = typeof ans?.probabilities?.yes === 'number' ? ans.probabilities.yes : null;

  // Calibrated score: use probYes directly; fallback to confidence margin conversion if missing
  let score = 0.5;
  if (typeof probYes === 'number') {
    score = probYes;
  } else if (typeof rawConfidence === 'number') {
    score = isYes ? 0.5 + (rawConfidence / 2) : 0.5 - (rawConfidence / 2);
  } else if (isYes) {
    score = 0.95;
  } else if (isNo) {
    score = 0.05;
  }

  return {
    score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
    confidence: typeof rawConfidence === 'number' ? Math.round(rawConfidence * 100) / 100 : null,
    choice: ans?.choice || (score >= 0.5 ? 'yes' : 'no'),
    probabilities: ans?.probabilities,
    model: data.model ? `typesafe-ai/${data.model}` : 'typesafe-ai/jev',
    answers: data.answers,
    usage: data.usage,
  };
}


/**
 * Call Gemini Flash API for score-only detection (minimal output tokens: ~5-10 tokens)
 */
async function detectAIWithGemini(text, apiKey, retries = 2) {
  const model = 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const systemPrompt = `You are a specialized AI script detector for YouTube video transcripts.
Analyze whether the transcript was generated by an AI language model (ChatGPT, Claude, Gemini, etc.) or naturally spoken/written by a human creator.

Key AI Slop Signals: Formulaic intros/outros ("In today's video", "Have you ever wondered", "In conclusion"), robotic listicle transitions ("Furthermore", "Moreover", "Additionally", "It is important to remember"), uniform cadence, buzzword padding.
Key Human Signals: Natural conversational flow, colloquial speech, casual humor, spontaneous tangents, personal anecdotes, authentic cadence.

Respond ONLY with a JSON object containing the probability score from 0.0 (definitely human) to 1.0 (definitely AI):
{"score": <number>}`;

  const prompt = `Evaluate AI likelihood for this transcript:\n"""\n${text}\n"""`;

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

      return typeof parsed.score === 'number'
        ? Math.max(0, Math.min(1, parsed.score))
        : 0.5;
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

