#!/usr/bin/env node
/**
 * Build a caption-verified YouTube benchmark corpus.
 *
 * This intentionally labels only provenance that can be inferred before a
 * detector sees the transcript:
 *   human — a TED speaker presentation (known human performer)
 *   ai — title explicitly declares an AI-generated/AI-made work
 *   mixed — title explicitly declares AI-assisted production
 *
 * Run: node build-dataset.mjs
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const exec = promisify(execFile);
const root = new URL('.', import.meta.url);
const output = new URL('./dataset.json', root);
// Caption availability is uneven: visual-first synthetic clips almost never
// expose a transcript.  This deliberately favors verifiable examples over an
// artificial class balance.
// A balanced-enough three-way corpus gives each detector a meaningful positive
// sample while retaining a substantial human control group.
const TARGETS = { human: 250, ai: 125, mixed: 125 };
const humanSearches = [
  'TED talk science', 'TED talk health', 'TED talk psychology', 'TED talk technology',
  'TED talk business', 'TED talk education', 'TED talk society', 'TED talk creativity',
  'TED talk environment', 'TED talk history', 'TED talk leadership', 'TED talk relationships',
  'TEDx talk science', 'TEDx talk health', 'TEDx talk technology', 'TEDx talk society',
  'TEDx talk business', 'TEDx talk psychology',
];

const searches = {
  ai: [
    '"AI generated" "narrated"', '"AI generated" "AI voice"',
    '"AI generated" "full story"', '"AI narrator" story',
    '"AI narrated" story', '"using an AI Generated Voice"',
  ],
  mixed: [
    '"human narrated" "AI generated"', '"AI-assisted" animation',
    '"AI assisted" short film', '"made with AI" short film',
    '"created with AI" animation', '"AI filmmaking" short film',
    '"AI-assisted" film', '"AI assisted" film',
    '"AI-assisted" music video', '"AI assisted" music video',
    '"made with AI" animation', '"made with AI" video',
    '"AI-assisted" story', '"AI assisted" story',
  ],
};

function parseJsonLines(stdout) {
  return stdout.split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

async function list(url, limit) {
  const { stdout } = await exec('yt-dlp', [
    '--flat-playlist', '--playlist-end', String(limit), '--dump-json', url,
  ], { maxBuffer: 20 * 1024 * 1024, timeout: 180_000 });
  return parseJsonLines(stdout)
    .filter((v) => /^[\w-]{11}$/.test(v.id) && v.duration >= 60 && !v.live_status)
    .map((v) => ({ id: v.id, title: v.title.replace(/\s+/g, ' ').trim(), channel: v.channel || v.playlist_uploader || 'Unknown' }));
}

function isWork(title, label) {
  const lower = title.toLowerCase();
  if (/\b(how to|tutorial|workflow|guide|course|learn|explained|review)\b/.test(lower)) return false;
  if (label === 'ai') return /\b(ai[ -]?(generated|made|created|narrated|voice)|ai (short film|drama|animation|music video|narrator))\b/.test(lower);
  return /\b(ai[ -]?assisted|made with ai|created with ai|ai filmmaking|human narrated.{0,30}ai generated|ai generated.{0,30}human narrated)\b/.test(lower);
}

async function hasEnglishCaptions(videoId) {
  const dir = await mkdtemp(join(tmpdir(), 'sts-caption-'));
  try {
    await exec('yt-dlp', [
      '--cookies-from-browser', 'chrome',
      '--write-auto-sub', '--write-sub', '--sub-langs', 'en', '--sub-format', 'json3',
      '--skip-download', '--no-warnings', '--quiet', '-o', join(dir, '%(id)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 45_000 });
    const names = await readdir(dir);
    const subtitle = names.find((name) => name.endsWith('.en.json3'));
    if (!subtitle) return false;
    const data = JSON.parse(await readFile(join(dir, subtitle), 'utf8'));
    const text = (data.events || []).flatMap((e) => e.segs || []).map((s) => s.utf8 || '').join(' ').trim();
    return text.length >= 50;
  } catch { return false; }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function captionFilter(candidates, target, label) {
  const accepted = [];
  const acceptedTitles = new Set();
  let next = 0;
  async function worker() {
    while (next < candidates.length && accepted.length < target) {
      const candidate = candidates[next++];
      if (await hasEnglishCaptions(candidate.id) && !acceptedTitles.has(candidate.title)) {
        acceptedTitles.add(candidate.title);
        accepted.push(candidate);
      }
      process.stderr.write(`\r${label}: ${accepted.length}/${target} checked ${next}/${candidates.length}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  process.stderr.write('\n');
  return accepted.slice(0, target);
}

function entry(video, label, category, evidence) {
  return {
    videoId: video.id,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    label,
    category,
    title: video.title,
    channel: video.channel,
    note: evidence,
  };
}

async function main() {
  const humanCandidates = [];
  const humanSeen = new Set();
  for (const query of humanSearches) {
    for (const video of await list(`ytsearch100:${query}`, 100)) {
      // Search returns adjacent channels too; retain only official TED/TEDx uploads.
      if ((video.channel === 'TED' || video.channel === 'TEDx Talks') && !humanSeen.has(video.id)) {
        humanSeen.add(video.id);
        humanCandidates.push(video);
      }
    }
  }
  const human = await captionFilter(humanCandidates, TARGETS.human, 'human');

  const groups = { human: human.map((v) => entry(v, 'human', 'speaker_presentation', 'TED presentation: identified human speaker; English captions verified at build time.')) };
  for (const label of ['ai', 'mixed']) {
    const candidates = [];
    const seen = new Set();
    for (const query of searches[label]) {
      for (const video of await list(`ytsearch100:${query}`, 100)) {
        if (!seen.has(video.id) && isWork(video.title, label)) { seen.add(video.id); candidates.push(video); }
      }
    }
    const selected = await captionFilter(candidates, TARGETS[label], label);
    groups[label] = selected.map((v) => entry(
      v, label, label === 'ai' ? 'declared_ai_generated' : 'declared_ai_assisted',
      label === 'ai'
        ? 'Title explicitly declares AI-generated/AI-made/narrated content; English captions verified at build time.'
        : 'Title explicitly declares AI-assisted or AI-made production; English captions verified at build time.',
    ));
  }
  const dataset = [...groups.human, ...groups.ai, ...groups.mixed];
  if (dataset.length !== 500) throw new Error(`Expected 500 rows, got ${dataset.length}`);
  await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))));
}

main().catch((error) => { console.error(error); process.exit(1); });
