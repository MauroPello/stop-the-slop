#!/usr/bin/env node
/**
 * Jev Benchmark Analyzer
 *
 * Reads results.json and produces distribution analysis to help decide
 * how to map Jev's raw output into a meaningful AI probability score.
 *
 * Usage:
 *   node analyze.js
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = resolve(__dirname, 'results.json');

// ── Stats helpers ───────────────────────────────────────────────────────────────

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function min(arr) {
  return arr.length ? Math.min(...arr) : null;
}
function max(arr) {
  return arr.length ? Math.max(...arr) : null;
}

function fmt(v, decimals = 3) {
  if (v === null || v === undefined) return '—';
  return v.toFixed(decimals);
}

function pct(v) {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v * 100)}%`;
}

// ── Confusion Matrix ────────────────────────────────────────────────────────────

function confusionAtThreshold(entries, threshold, scoreField) {
  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const e of entries) {
    const score = e[scoreField];
    if (score === null || score === undefined) continue;

    const predicted = score >= threshold ? 'ai' : 'human';
    const actual = e.label;

    if (actual === 'ai' && predicted === 'ai') tp++;
    else if (actual === 'ai' && predicted === 'human') fn++;
    else if (actual === 'human' && predicted === 'ai') fp++;
    else if (actual === 'human' && predicted === 'human') tn++;
    // Skip 'mixed' for confusion matrix
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn) || 0;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { threshold, tp, fp, tn, fn, accuracy, precision, recall, f1 };
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const raw = JSON.parse(await readFile(RESULTS_PATH, 'utf-8'));
  const allEntries = Object.values(raw).filter((e) => e.jev && !e.error);

  if (allEntries.length === 0) {
    console.error('❌ No successful results found in results.json. Run benchmark first.');
    process.exit(1);
  }

  console.log('═'.repeat(70));
  console.log('  JEV BENCHMARK ANALYSIS');
  console.log('═'.repeat(70));
  console.log(`\n  Total entries with Jev results: ${allEntries.length}`);

  // Group by label
  const groups = { human: [], ai: [], mixed: [] };
  for (const e of allEntries) {
    const label = e.label || 'mixed';
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }

  console.log(`  Human: ${groups.human.length} | AI: ${groups.ai.length} | Mixed: ${groups.mixed.length}\n`);

  // ── Section 1: Raw Jev Output Distribution ──────────────────────────────────

  console.log('─'.repeat(70));
  console.log('  1. RAW JEV OUTPUT DISTRIBUTION');
  console.log('─'.repeat(70));

  for (const [label, entries] of Object.entries(groups)) {
    if (entries.length === 0) continue;

    const choices = entries.map((e) => e.jev.choice);
    const yesCount = choices.filter((c) => c === 'yes').length;
    const noCount = choices.filter((c) => c === 'no').length;

    const confidences = entries.map((e) => e.jev.confidence).filter((v) => typeof v === 'number');
    const probYeses = entries.map((e) => e.jev.probYes).filter((v) => typeof v === 'number');
    const currentScores = entries.map((e) => e.currentMappedScore).filter((v) => typeof v === 'number');

    console.log(`\n  ▸ ${label.toUpperCase()} videos (n=${entries.length}):`);
    console.log(`    Choice distribution:  yes=${yesCount}  no=${noCount}`);

    if (confidences.length > 0) {
      console.log(`    confidence:  min=${fmt(min(confidences))}  max=${fmt(max(confidences))}  mean=${fmt(mean(confidences))}  median=${fmt(median(confidences))}  stddev=${fmt(stddev(confidences))}`);
    } else {
      console.log(`    confidence:  (no data)`);
    }

    if (probYeses.length > 0) {
      console.log(`    probYes:     min=${fmt(min(probYeses))}  max=${fmt(max(probYeses))}  mean=${fmt(mean(probYeses))}  median=${fmt(median(probYeses))}  stddev=${fmt(stddev(probYeses))}`);
    } else {
      console.log(`    probYes:     (no data)`);
    }

    console.log(`    currentScore: min=${fmt(min(currentScores))}  max=${fmt(max(currentScores))}  mean=${fmt(mean(currentScores))}  median=${fmt(median(currentScores))}  stddev=${fmt(stddev(currentScores))}`);
  }

  // ── Section 2: Per-Video Detail ─────────────────────────────────────────────

  console.log('\n' + '─'.repeat(70));
  console.log('  2. PER-VIDEO DETAIL');
  console.log('─'.repeat(70));

  const colW = { vid: 13, label: 7, choice: 8, conf: 8, probY: 8, score: 8, note: 40 };

  console.log(
    `\n  ${'VideoId'.padEnd(colW.vid)} ${'Label'.padEnd(colW.label)} ${'Choice'.padEnd(colW.choice)} ${'Conf'.padEnd(colW.conf)} ${'ProbYes'.padEnd(colW.probY)} ${'Score'.padEnd(colW.score)} Note`
  );
  console.log(`  ${'─'.repeat(colW.vid)} ${'─'.repeat(colW.label)} ${'─'.repeat(colW.choice)} ${'─'.repeat(colW.conf)} ${'─'.repeat(colW.probY)} ${'─'.repeat(colW.score)} ${'─'.repeat(colW.note)}`);

  // Sort: AI first, then mixed, then human; within each group sort by currentMappedScore desc
  const labelOrder = { ai: 0, mixed: 1, human: 2 };
  const sorted = [...allEntries].sort((a, b) => {
    const lo = (labelOrder[a.label] ?? 9) - (labelOrder[b.label] ?? 9);
    if (lo !== 0) return lo;
    return (b.currentMappedScore ?? 0) - (a.currentMappedScore ?? 0);
  });

  for (const e of sorted) {
    const flag =
      (e.label === 'human' && e.currentMappedScore >= 0.5) ? '⚠️ FP' :
      (e.label === 'ai' && e.currentMappedScore < 0.5) ? '⚠️ FN' : '';

    const noteTrunc = (e.note || '').slice(0, colW.note);
    console.log(
      `  ${e.videoId.padEnd(colW.vid)} ${e.label.padEnd(colW.label)} ${(e.jev.choice || '?').padEnd(colW.choice)} ${fmt(e.jev.confidence).padEnd(colW.conf)} ${fmt(e.jev.probYes).padEnd(colW.probY)} ${pct(e.currentMappedScore).padEnd(colW.score)} ${noteTrunc} ${flag}`
    );
  }

  // ── Section 3: Confusion Matrix at Various Thresholds ───────────────────────

  console.log('\n' + '─'.repeat(70));
  console.log('  3. CONFUSION MATRIX (current score mapping, excludes "mixed")');
  console.log('─'.repeat(70));

  const binaryEntries = allEntries
    .filter((e) => e.label === 'human' || e.label === 'ai')
    .map((e) => ({ label: e.label, currentMappedScore: e.currentMappedScore }));

  const thresholds = [0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.65, 0.7, 0.8];

  console.log(`\n  ${'Thresh'.padEnd(8)} ${'TP'.padEnd(5)} ${'FP'.padEnd(5)} ${'TN'.padEnd(5)} ${'FN'.padEnd(5)} ${'Acc'.padEnd(8)} ${'Prec'.padEnd(8)} ${'Recall'.padEnd(8)} ${'F1'.padEnd(8)}`);
  console.log(`  ${'─'.repeat(8)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)}`);

  for (const t of thresholds) {
    const cm = confusionAtThreshold(binaryEntries, t, 'currentMappedScore');
    console.log(
      `  ${t.toFixed(2).padEnd(8)} ${String(cm.tp).padEnd(5)} ${String(cm.fp).padEnd(5)} ${String(cm.tn).padEnd(5)} ${String(cm.fn).padEnd(5)} ${pct(cm.accuracy).padEnd(8)} ${pct(cm.precision).padEnd(8)} ${pct(cm.recall).padEnd(8)} ${pct(cm.f1).padEnd(8)}`
    );
  }

  // ── Section 4: Alternative Score Mappings ──────────────────────────────────

  console.log('\n' + '─'.repeat(70));
  console.log('  4. ALTERNATIVE SCORE MAPPINGS');
  console.log('─'.repeat(70));

  // Mapping A: probYes directly (if available)
  // Mapping B: confidence as-is (don't flip for "no")
  // Mapping C: confidence flipped for "no" (current)
  // Mapping D: probYes with fallback to flipped confidence

  const mappings = {
    'A: probYes raw': (e) => e.jev.probYes,
    'B: confidence raw': (e) => e.jev.confidence,
    'C: current (flip for no)': (e) => e.currentMappedScore,
    'D: probYes ?? flip conf': (e) => {
      if (typeof e.jev.probYes === 'number') return e.jev.probYes;
      if (typeof e.jev.confidence === 'number') {
        return e.jev.choice === 'no'
          ? Math.max(0, 1 - e.jev.confidence)
          : e.jev.confidence;
      }
      return e.jev.choice === 'yes' ? 0.95 : 0.05;
    },
  };

  for (const [name, mapFn] of Object.entries(mappings)) {
    console.log(`\n  ▸ Mapping "${name}":`);

    const mapped = binaryEntries.map((e) => {
      const fullEntry = allEntries.find((a) => a.videoId === e.label); // won't work, need original
      return e;
    });

    // We need the full entries for alternative mappings
    const fullBinary = allEntries.filter((e) => e.label === 'human' || e.label === 'ai');

    const aiScores = fullBinary.filter((e) => e.label === 'ai').map(mapFn).filter((v) => typeof v === 'number');
    const humanScores = fullBinary.filter((e) => e.label === 'human').map(mapFn).filter((v) => typeof v === 'number');

    if (aiScores.length === 0 && humanScores.length === 0) {
      console.log(`    (no data for this mapping)`);
      continue;
    }

    console.log(`    AI scores:    min=${fmt(min(aiScores))}  max=${fmt(max(aiScores))}  mean=${fmt(mean(aiScores))}  median=${fmt(median(aiScores))}`);
    console.log(`    Human scores: min=${fmt(min(humanScores))}  max=${fmt(max(humanScores))}  mean=${fmt(mean(humanScores))}  median=${fmt(median(humanScores))}`);

    // Separation gap
    const aiMin = min(aiScores);
    const humanMax = max(humanScores);
    if (aiMin !== null && humanMax !== null) {
      const gap = aiMin - humanMax;
      if (gap > 0) {
        console.log(`    ✅ Clean separation! Gap: ${fmt(gap)} (AI min ${fmt(aiMin)} > Human max ${fmt(humanMax)})`);
      } else {
        console.log(`    ⚠️  Overlap: ${fmt(Math.abs(gap))} (AI min ${fmt(aiMin)}, Human max ${fmt(humanMax)})`);
      }
    }

    // Best threshold for this mapping
    let bestF1 = 0;
    let bestThresh = 0.5;
    for (let t = 0.1; t <= 0.9; t += 0.05) {
      const testEntries = fullBinary.map((e) => ({ label: e.label, score: mapFn(e) }));
      const cm = confusionAtThreshold(testEntries, t, 'score');
      if (cm.f1 > bestF1) {
        bestF1 = cm.f1;
        bestThresh = t;
      }
    }
    console.log(`    Best F1 threshold: ${fmt(bestThresh)} → F1=${pct(bestF1)}`);
  }

  // ── Section 5: Recommendations ────────────────────────────────────────────

  console.log('\n' + '─'.repeat(70));
  console.log('  5. RECOMMENDATIONS');
  console.log('─'.repeat(70));

  // Check if probYes is available
  const probYesAvailable = allEntries.filter((e) => typeof e.jev.probYes === 'number').length;
  const confAvailable = allEntries.filter((e) => typeof e.jev.confidence === 'number').length;

  console.log(`\n  Data availability:`);
  console.log(`    - probYes available: ${probYesAvailable}/${allEntries.length} entries`);
  console.log(`    - confidence available: ${confAvailable}/${allEntries.length} entries`);

  if (probYesAvailable > allEntries.length * 0.8) {
    console.log(`\n  💡 probYes is widely available — consider using it directly as the score.`);
    console.log(`     It represents P(AI-generated) which is exactly what you want to show.`);
  } else if (confAvailable > allEntries.length * 0.8) {
    console.log(`\n  💡 Only confidence is widely available. The choice+confidence mapping`);
    console.log(`     needs careful calibration based on the distributions above.`);
  }

  console.log(`\n  Review the per-video detail and confusion matrices above.`);
  console.log(`  Look for:`);
  console.log(`    1. False positives (⚠️ FP): human videos scored as AI — these hurt creators`);
  console.log(`    2. False negatives (⚠️ FN): AI videos scored as human — these miss slop`);
  console.log(`    3. The threshold with best F1 and lowest FP rate`);
  console.log(`    4. Whether probYes or confidence+choice gives better separation\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
