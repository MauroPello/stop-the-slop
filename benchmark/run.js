#!/usr/bin/env node
/**
 * Multi-Provider AI Detection Benchmark Runner
 *
 * Runs YouTube transcripts through up to THREE AI detection engines
 * as INDEPENDENT CONCURRENT QUEUES:
 *   1. TypeSafe Jev  (fast queue, ~500ms delay)
 *   2. Google Gemini  (fast queue, ~200ms delay)
 *   3. WasItAiGenerated.com (local Hugging Face model)
 *   4. RADAR-Vicuna-7B     (local Hugging Face model)
 *
 * Each provider runs its own loop through all videos independently.
 * Jev and Gemini can run alongside the local model queues.
 * Transcripts are fetched once and shared across all queues.
 *
 * Usage:
 *   node run.js                           # Run all available providers
 *   node run.js --force                   # Re-run everything
 *   node run.js --providers jev,gemini    # Only run specific providers
 *   node run.js --force-provider gemini   # Re-run only Gemini for all videos
 *
 * Results are saved to results.json (resumable — one entry per video with per-provider outputs).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────────
const DATASET_PATH = resolve(__dirname, 'dataset.json');
const RESULTS_PATH = resolve(__dirname, 'results.json');
const TRANSCRIPT_MAX_CHARS = 15_000;
const FORCE = process.argv.includes('--force');

// Per-provider delay (ms) between sequential calls
const PROVIDER_DELAYS = {
  jev: 0,
  gemini: 0,
  wasitaigenerated: 0,
  radar: 0,
};
const PROVIDER_CONCURRENCY = 2;

const PROVIDER_EMOJI = { jev: '🔮', gemini: '💎', wasitaigenerated: '🌱', radar: '📡' };

// ── CLI Parsing ─────────────────────────────────────────────────────────────────

function parseProviderFlags() {
  const providersIdx = process.argv.indexOf('--providers');
  const forceProviderIdx = process.argv.indexOf('--force-provider');

  let requestedProviders = null;
  let forceProvider = null;

  if (providersIdx !== -1 && process.argv[providersIdx + 1]) {
    requestedProviders = process.argv[providersIdx + 1].split(',').map((s) => s.trim().toLowerCase());
  }
  if (forceProviderIdx !== -1 && process.argv[forceProviderIdx + 1]) {
    forceProvider = process.argv[forceProviderIdx + 1].trim().toLowerCase();
  }

  return { requestedProviders, forceProvider };
}

// ── Load .env manually (no dependencies) ────────────────────────────────────────
function loadEnvFile() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { }
}
loadEnvFile();

// ── Determine available providers ───────────────────────────────────────────────

const TYPESAFE_KEY = process.env.TYPESAFE_API_KEY || process.env.VERCEL_AI_GATEWAY_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN;

const AVAILABLE_PROVIDERS = {};
if (TYPESAFE_KEY) AVAILABLE_PROVIDERS.jev = true;
if (GEMINI_KEY) AVAILABLE_PROVIDERS.gemini = true;
// The model is public, but HF_TOKEN avoids download throttling and supports gated
// revisions if one is selected later. It is intentionally never persisted.
AVAILABLE_PROVIDERS.wasitaigenerated = true;
AVAILABLE_PROVIDERS.radar = true;

if (Object.keys(AVAILABLE_PROVIDERS).length === 0) {
  console.error('❌ No providers available. Install benchmark Python dependencies or set TYPESAFE_API_KEY / GEMINI_API_KEY.');
  process.exit(1);
}

// ── Shared results + write lock ─────────────────────────────────────────────────

let results = {};
let writePending = false;
let writeQueued = false;

function migrateProviderNames() {
  for (const entry of Object.values(results)) {
    if (!entry?.tropa || entry.wasitaigenerated) continue;
    entry.wasitaigenerated = {
      ...entry.tropa,
      provider: 'wasitaigenerated',
      displayName: 'WasItAiGenerated.com',
    };
    delete entry.tropa;
  }
}

/**
 * Debounced results writer — prevents concurrent writes and batches rapid updates.
 */
async function saveResults() {
  if (writePending) {
    writeQueued = true;
    return;
  }
  writePending = true;
  try {
    await writeFile(RESULTS_PATH, JSON.stringify(results, null, 2));
  } finally {
    writePending = false;
    if (writeQueued) {
      writeQueued = false;
      await saveResults();
    }
  }
}

// ── Shared transcript cache ─────────────────────────────────────────────────────
// Each transcript is fetched at most once. Multiple provider queues
// awaiting the same video will share the same fetch promise.

const transcriptCache = new Map(); // videoId → Promise<{text, charCount, ...} | null>

function getTranscript(videoId) {
  if (transcriptCache.has(videoId)) return transcriptCache.get(videoId);

  // Check if we already have the transcript in results from a previous run
  if (results[videoId]?.transcript?.fullText) {
    const cached = results[videoId].transcript;
    const promise = Promise.resolve({
      text: cached.fullText,
      charCount: cached.charCount,
      language: cached.language,
      isAutoGenerated: cached.isAutoGenerated,
    });
    transcriptCache.set(videoId, promise);
    return promise;
  }

  // Fetch and cache the promise
  const promise = fetchTranscriptWithRetry(videoId).then((t) => {
    // Store in results for future reuse
    if (!results[videoId]) results[videoId] = {};
    results[videoId].transcript = {
      charCount: t.charCount,
      language: t.language,
      isAutoGenerated: t.isAutoGenerated,
      preview: t.text.slice(0, 200),
      fullText: t.text,
    };
    return t;
  }).catch((err) => {
    // Store the error so other queues don't retry
    if (!results[videoId]) results[videoId] = {};
    results[videoId].transcriptError = err.message;
    return null;
  });

  transcriptCache.set(videoId, promise);
  return promise;
}

async function fetchTranscriptWithRetry(videoId) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchTranscript(videoId);
    } catch (error) {
      lastError = error;
      if (!/\b429\b|too many requests/i.test(error.message) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
  throw lastError;
}

// ── YouTube Transcript Fetcher (via yt-dlp) ─────────────────────────────────────

// Keep subtitle retrieval bounded while allowing enough parallelism to avoid a
// single-file bottleneck. HTTP 429 responses are retried by the wrapper above.
const YTDLP_CONCURRENCY = 3;
let ytdlpActive = 0;
const ytdlpQueue = [];

async function acquireYtdlp() {
  if (ytdlpActive < YTDLP_CONCURRENCY) {
    ytdlpActive++;
    return;
  }
  return new Promise((resolve) => ytdlpQueue.push(resolve));
}

function releaseYtdlp() {
  if (ytdlpQueue.length > 0) {
    const next = ytdlpQueue.shift();
    next();
  } else {
    ytdlpActive--;
  }
}

async function fetchTranscript(videoId) {
  await acquireYtdlp();
  const tmpFile = join(tmpdir(), `sts_bench_${videoId}`);
  const subFile = `${tmpFile}.en.json3`;

  try {
    await execFileAsync('yt-dlp', [
      '--cookies-from-browser', 'chrome',
      '--write-auto-sub',
      '--write-sub',
      '--sub-lang', 'en',
      '--skip-download',
      '--sub-format', 'json3',
      '--no-warnings',
      '--quiet',
      '-o', tmpFile,
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 30_000 });

    let captionData;
    try {
      const raw = readFileSync(subFile, 'utf-8');
      captionData = JSON.parse(raw);
    } catch {
      throw new Error('No English subtitles available');
    }

    const events = captionData?.events;
    if (!events || events.length === 0) throw new Error('Caption data is empty');

    const textParts = [];
    for (const event of events) {
      if (event.segs) {
        for (const seg of event.segs) {
          if (seg.utf8 && seg.utf8.trim() !== '\n') {
            textParts.push(seg.utf8.trim());
          }
        }
      }
    }

    const fullText = textParts.join(' ').replace(/\s+/g, ' ').trim();
    if (fullText.length < 50) throw new Error(`Transcript too short (${fullText.length} chars)`);

    return { text: fullText, language: 'en', isAutoGenerated: true, charCount: fullText.length };
  } finally {
    releaseYtdlp();
    try { await unlink(subFile); } catch { }
    try {
      for (const f of readdirSync(tmpdir())) {
        if (f.startsWith(`sts_bench_${videoId}`)) {
          try { await unlink(join(tmpdir(), f)); } catch { }
        }
      }
    } catch { }
  }
}

// ── Provider: Jev (TypeSafe AI API) ─────────────────────────────────────────────

async function callJev(text) {
  const promptState = text.slice(0, TRANSCRIPT_MAX_CHARS);

  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TYPESAFE_KEY}`,
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

    if (response.status === 429 && attempt < 3) {
      const wait = attempt * 2000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    break;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let msg = `Jev API error (${response.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.detail?.message) msg = parsed.detail.message;
      else if (typeof parsed.detail === 'string') msg = parsed.detail;
      else if (parsed.error?.message) msg = parsed.error.message;
    } catch {
      if (errText) msg += `: ${errText.slice(0, 180)}`;
    }
    throw new Error(msg);
  }

  const data = await response.json();
  const ans = data.answers?.is_ai;

  return {
    provider: 'jev',
    choice: ans?.choice || null,
    confidence: ans?.confidence ?? null,
    probabilities: ans?.probabilities || null,
    probYes: ans?.probabilities?.yes ?? null,
    probNo: ans?.probabilities?.no ?? null,
    score: computeJevScore(ans),
    model: data.model ? `typesafe-ai/${data.model}` : 'typesafe-ai/jev',
    usage: data.usage || null,
    rawAnswers: data.answers,
  };
}

function computeJevScore(ans) {
  const choice = ans?.choice;
  const confidence = ans?.confidence;
  const probYes = typeof ans?.probabilities?.yes === 'number' ? ans.probabilities.yes : null;
  const isYes = choice === 'yes';
  const isNo = choice === 'no';

  let score = 0.5;
  if (typeof probYes === 'number') {
    score = probYes;
  } else if (typeof confidence === 'number') {
    score = isYes ? 0.5 + (confidence / 2) : 0.5 - (confidence / 2);
  } else if (isYes) {
    score = 0.95;
  } else if (isNo) {
    score = 0.05;
  }

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

// ── Provider: Gemini (Google AI API) ────────────────────────────────────────────

async function callGemini(text) {
  const model = 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

  const systemPrompt = `You are a specialized AI script detector for YouTube video transcripts.
Analyze whether the transcript was generated by an AI language model (ChatGPT, Claude, Gemini, etc.) or naturally spoken/written by a human creator.

Key AI Slop Signals: Formulaic intros/outros ("In today's video", "Have you ever wondered", "In conclusion"), robotic listicle transitions ("Furthermore", "Moreover", "Additionally", "It is important to remember"), uniform cadence, buzzword padding.
Key Human Signals: Natural conversational flow, colloquial speech, casual humor, spontaneous tangents, personal anecdotes, authentic cadence.

Respond ONLY with a JSON object containing the probability score from 0.0 (definitely human) to 1.0 (definitely AI):
{"score": <number>}`;

  const prompt = `Evaluate AI likelihood for this transcript:\n"""\n${text.slice(0, TRANSCRIPT_MAX_CHARS)}\n"""`;

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (response.status === 429) {
        if (attempt < 2) {
          const wait = (attempt + 1) * 2000;
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw new Error('Gemini rate limited after retries');
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Gemini API error (${response.status}): ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawOutput) throw new Error('Empty response from Gemini');

      const cleanJson = rawOutput.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);
      const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : 0.5;

      return {
        provider: 'gemini',
        score,
        model: `google/${model}`,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount || null,
          outputTokens: data.usageMetadata?.candidatesTokenCount || null,
        },
        rawOutput: cleanJson,
      };
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ── Provider: WasItAiGenerated.com (local Hugging Face model) ─────────────────

const WASITAI_SCRIPT = resolve(__dirname, 'tropa_infer.py');
let wasitaiProcess = null;
let wasitaiReady = null;
let wasitaiStartupError = null;
let wasitaiStarted = false;
let wasitaiStdoutBuffer = '';
const wasitaiPending = [];

function startWasItAiGenerated() {
  if (wasitaiStartupError) return Promise.reject(wasitaiStartupError);
  if (wasitaiReady) return wasitaiReady;

  wasitaiReady = new Promise((resolveReady, rejectReady) => {
    const python = process.env.PYTHON || 'python3';
    wasitaiProcess = spawn(python, [WASITAI_SCRIPT], {
      cwd: __dirname,
      env: { ...process.env, ...(HF_TOKEN ? { HF_TOKEN } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rejectPending = (error) => {
      while (wasitaiPending.length) wasitaiPending.shift().reject(error);
    };

    wasitaiProcess.stdout.setEncoding('utf8');
    wasitaiProcess.stdout.on('data', (chunk) => {
      wasitaiStdoutBuffer += chunk;
      let newline;
      while ((newline = wasitaiStdoutBuffer.indexOf('\n')) !== -1) {
        const line = wasitaiStdoutBuffer.slice(0, newline);
        wasitaiStdoutBuffer = wasitaiStdoutBuffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.ready) {
            wasitaiStarted = true;
            resolveReady();
          } else {
            const pending = wasitaiPending.shift();
            if (!pending) continue;
            if (message.error) pending.reject(new Error(message.error));
            else pending.resolve(message);
          }
        } catch {
          rejectPending(new Error(`Invalid response from WasItAiGenerated.com: ${line.slice(0, 200)}`));
        }
      }
    });
    wasitaiProcess.stderr.setEncoding('utf8');
    wasitaiProcess.stderr.on('data', (chunk) => process.stderr.write(`[wasitai] ${chunk}`));
    wasitaiProcess.once('error', (error) => {
      wasitaiStartupError = error;
      rejectReady(error);
      rejectPending(error);
    });
    wasitaiProcess.once('exit', (code) => {
      const error = new Error(`WasItAiGenerated.com process exited${code === 0 ? '' : ` (${code})`}`);
      if (!wasitaiStarted) wasitaiStartupError = error;
      rejectReady(error);
      rejectPending(error);
      wasitaiProcess = null;
      wasitaiReady = null;
    });
  });
  return wasitaiReady;
}

async function callWasItAiGenerated(text) {
  await startWasItAiGenerated();
  return new Promise((resolveResult, rejectResult) => {
    wasitaiPending.push({ resolve: resolveResult, reject: rejectResult });
    wasitaiProcess.stdin.write(`${JSON.stringify({ text: text.slice(0, TRANSCRIPT_MAX_CHARS) })}\n`);
  });
}

function stopWasItAiGenerated() {
  if (wasitaiProcess && !wasitaiProcess.killed) wasitaiProcess.stdin.end();
}

// ── Provider: RADAR-Vicuna-7B (local Hugging Face model) ───────────────────────

const RADAR_SCRIPT = resolve(__dirname, 'radar_infer.py');
let radarProcess = null;
let radarReady = null;
let radarStartupError = null;
let radarStarted = false;
let radarStdoutBuffer = '';
const radarPending = [];

function startRadar() {
  if (radarStartupError) return Promise.reject(radarStartupError);
  if (radarReady) return radarReady;

  radarReady = new Promise((resolveReady, rejectReady) => {
    const python = process.env.PYTHON || 'python3';
    radarProcess = spawn(python, [RADAR_SCRIPT], {
      cwd: __dirname,
      env: { ...process.env, ...(HF_TOKEN ? { HF_TOKEN } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rejectPending = (error) => {
      while (radarPending.length) radarPending.shift().reject(error);
    };

    radarProcess.stdout.setEncoding('utf8');
    radarProcess.stdout.on('data', (chunk) => {
      radarStdoutBuffer += chunk;
      let newline;
      while ((newline = radarStdoutBuffer.indexOf('\n')) !== -1) {
        const line = radarStdoutBuffer.slice(0, newline);
        radarStdoutBuffer = radarStdoutBuffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.ready) {
            radarStarted = true;
            resolveReady();
          } else {
            const pending = radarPending.shift();
            if (!pending) continue;
            if (message.error) pending.reject(new Error(message.error));
            else pending.resolve(message);
          }
        } catch {
          rejectPending(new Error(`Invalid response from RADAR: ${line.slice(0, 200)}`));
        }
      }
    });
    radarProcess.stderr.setEncoding('utf8');
    radarProcess.stderr.on('data', (chunk) => process.stderr.write(`[radar] ${chunk}`));
    radarProcess.once('error', (error) => {
      radarStartupError = error;
      rejectReady(error);
      rejectPending(error);
    });
    radarProcess.once('exit', (code) => {
      const error = new Error(`RADAR process exited${code === 0 ? '' : ` (${code})`}`);
      if (!radarStarted) radarStartupError = error;
      rejectReady(error);
      rejectPending(error);
      radarProcess = null;
      radarReady = null;
    });
  });
  return radarReady;
}

async function callRadar(text) {
  await startRadar();
  return new Promise((resolveResult, rejectResult) => {
    radarPending.push({ resolve: resolveResult, reject: rejectResult });
    radarProcess.stdin.write(`${JSON.stringify({ text: text.slice(0, TRANSCRIPT_MAX_CHARS) })}\n`);
  });
}

function stopRadar() {
  if (!radarProcess || radarProcess.killed) return;
  radarProcess.stdin.end();
  // MPS can retain an idle worker after stdin closes; the queue is complete here.
  setTimeout(() => {
    if (radarProcess && !radarProcess.killed) radarProcess.kill();
  }, 1000).unref();
}

// ── Provider Registry ───────────────────────────────────────────────────────────

const PROVIDERS = {
  jev: { call: callJev },
  gemini: { call: callGemini },
  wasitaigenerated: { call: callWasItAiGenerated },
  radar: { call: callRadar },
};

// ── Independent Provider Queue ──────────────────────────────────────────────────

/**
 * Run a single provider through ALL videos independently.
 * Each provider has its own loop and pace.
 */
async function runProviderQueue(providerName, dataset, forceProvider) {
  const emoji = PROVIDER_EMOJI[providerName];
  const delay = PROVIDER_DELAYS[providerName] ?? 1000;
  const callFn = PROVIDERS[providerName].call;
  const stats = { success: 0, skipped: 0, noTranscript: 0, error: 0 };

  console.log(`\n${emoji} [${providerName}] Starting queue (${dataset.length} videos, ${delay}ms delay)\n`);

  let next = 0;
  async function worker() {
    while (next < dataset.length) {
      const i = next++;
    const entry = dataset[i];
    const { videoId, label, category, note } = entry;
    const idx = `[${i + 1}/${dataset.length}]`;

    // Skip if already done (unless forcing)
    const shouldRun = FORCE || forceProvider === providerName || !results[videoId]?.[providerName];
    if (!shouldRun) {
      stats.skipped++;
      continue;
    }

    // Ensure entry exists in results
    if (!results[videoId]) {
      results[videoId] = { ...entry };
    } else if (!results[videoId].label) {
      Object.assign(results[videoId], entry);
    }

    // Retry transient YouTube throttling instead of preserving it as a
    // permanent no-transcript result.
    if (/\b429\b|too many requests/i.test(results[videoId]?.transcriptError || '')) {
      delete results[videoId].transcriptError;
    }
    // Check if transcript previously failed permanently.
    if (results[videoId]?.transcriptError) {
      stats.noTranscript++;
      continue;
    }

    // Get transcript (shared cache — fetched only once across all queues)
    const transcript = await getTranscript(videoId);
    if (!transcript) {
      console.log(`${emoji} ${idx} ⏭️  ${videoId} — no transcript`);
      stats.noTranscript++;
      continue;
    }

    // Call the provider
    try {
      const result = await callFn(transcript.text);
      results[videoId][providerName] = {
        ...result,
        timestamp: new Date().toISOString(),
      };

      const scoreStr = typeof result.score === 'number' ? `${Math.round(result.score * 100)}%` : '?';
      const extra = result.choice ? ` choice=${result.choice}` : '';
      console.log(`${emoji} ${idx} ${videoId} (${label}) → ${scoreStr}${extra}`);
      stats.success++;
    } catch (err) {
      console.log(`${emoji} ${idx} ❌ ${videoId}: ${err.message}`);
      stats.error++;
    }

    // Save incrementally
    await saveResults();

    // Provider-specific delay
    if (i < dataset.length - 1) {
      await new Promise((r) => setTimeout(r, delay));
    }
    }
  }
  await Promise.all(Array.from({ length: PROVIDER_CONCURRENCY }, worker));

  console.log(`\n${emoji} [${providerName}] DONE — ${stats.success} success, ${stats.skipped} skipped, ${stats.noTranscript} no transcript, ${stats.error} errors`);
  return stats;
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const { requestedProviders, forceProvider } = parseProviderFlags();

  // Determine active providers
  let activeProviders = Object.keys(AVAILABLE_PROVIDERS);
  if (requestedProviders) {
    activeProviders = requestedProviders.filter((p) => AVAILABLE_PROVIDERS[p]);
    const unavailable = requestedProviders.filter((p) => !AVAILABLE_PROVIDERS[p]);
    if (unavailable.length > 0) {
      console.warn(`⚠️  Providers unavailable (no API key): ${unavailable.join(', ')}`);
    }
  }

  if (activeProviders.length === 0) {
    console.error('❌ No providers available. Check your API keys.');
    process.exit(1);
  }

  console.log('🧪 Multi-Provider AI Detection Benchmark\n');
  console.log(`📡 Active providers: ${activeProviders.map((p) => `${PROVIDER_EMOJI[p]} ${p}`).join('  |  ')}`);
  console.log(`⚡ Mode: Independent concurrent queues (each provider runs at its own pace)`);
  if (FORCE) console.log('🔄 Force mode: re-running all entries');
  if (forceProvider) console.log(`🔄 Force-provider: re-running ${forceProvider} for all videos`);

  // Load dataset
  const dataset = JSON.parse(await readFile(DATASET_PATH, 'utf-8'));
  console.log(`📋 Dataset: ${dataset.length} videos`);

  // Load existing results
  if (!FORCE && existsSync(RESULTS_PATH)) {
    try {
      const existing = JSON.parse(await readFile(RESULTS_PATH, 'utf-8'));
      if (typeof existing === 'object' && !Array.isArray(existing)) {
        results = existing;
        migrateProviderNames();
      }
    } catch { }
  }

  // Pre-populate transcript cache from existing results
  for (const [videoId, entry] of Object.entries(results)) {
    if (entry?.transcript?.fullText) {
      transcriptCache.set(videoId, Promise.resolve({
        text: entry.transcript.fullText,
        charCount: entry.transcript.charCount,
        language: entry.transcript.language,
        isAutoGenerated: entry.transcript.isAutoGenerated,
      }));
    }
  }

  const cachedCount = transcriptCache.size;
  if (cachedCount > 0) {
    console.log(`📦 ${cachedCount} transcripts cached from previous runs`);
  }

  console.log('\n' + '═'.repeat(70));

  // Launch all provider queues concurrently — they each run independently
  const queuePromises = activeProviders.map((p) =>
    runProviderQueue(p, dataset, forceProvider)
  );

  let allStats;
  try {
    allStats = await Promise.all(queuePromises);
  } finally {
    stopWasItAiGenerated();
    stopRadar();
  }

  // Final summary
  console.log('\n' + '═'.repeat(70));
  console.log('  BENCHMARK RUN COMPLETE');
  console.log('═'.repeat(70) + '\n');

  for (let i = 0; i < activeProviders.length; i++) {
    const p = activeProviders[i];
    const s = allStats[i];
    console.log(`  ${PROVIDER_EMOJI[p]} ${p}: ${s.success} success, ${s.skipped} skipped, ${s.noTranscript} no transcript, ${s.error} errors`);
  }

  // Final save
  await saveResults();
  console.log(`\n  📁 Results saved to ${RESULTS_PATH}`);
  console.log('  Run `node analyze.js` to see multi-provider comparison.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
