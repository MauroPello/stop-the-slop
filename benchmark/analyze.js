#!/usr/bin/env node
/**
 * Multi-Provider Benchmark Analyzer
 *
 * Reads results.json (with jev, gemini, sapling per video) and produces:
 *   1. Per-provider distribution stats
 *   2. Head-to-head comparison table
 *   3. Per-provider confusion matrices at multiple thresholds
 *   4. Provider agreement analysis
 *   5. Consensus (ensemble) scoring
 *   6. Per-category breakdown
 *   7. Recommendations
 *
 * Usage:
 *   node analyze.js
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = resolve(__dirname, 'results.json');
const DATASET_PATH = resolve(__dirname, 'dataset.json');

const PROVIDER_NAMES = ['jev', 'gemini', 'sapling'];
const PROVIDER_EMOJI = { jev: '🔮', gemini: '💎', sapling: '🌿' };

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

function min(arr) { return arr.length ? Math.min(...arr) : null; }
function max(arr) { return arr.length ? Math.max(...arr) : null; }
function fmt(v, decimals = 3) { return v === null || v === undefined ? '—' : v.toFixed(decimals); }
function pct(v) { return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`; }

// ── Score extraction ────────────────────────────────────────────────────────────

function getProviderScore(entry, provider) {
  const data = entry[provider];
  if (!data) return null;
  if (typeof data.score === 'number') return data.score;
  // Jev fallback: compute from probYes/confidence
  if (provider === 'jev') {
    if (typeof data.probYes === 'number') return data.probYes;
    if (typeof data.confidence === 'number') {
      return data.choice === 'yes' ? 0.5 + (data.confidence / 2) : 0.5 - (data.confidence / 2);
    }
    return data.choice === 'yes' ? 0.95 : data.choice === 'no' ? 0.05 : null;
  }
  return null;
}

// ── Consensus score (median of available providers) ─────────────────────────────

function consensusScore(entry) {
  const scores = PROVIDER_NAMES.map((p) => getProviderScore(entry, p)).filter((v) => typeof v === 'number');
  if (scores.length === 0) return null;
  return median(scores);
}

// ── Confusion Matrix ────────────────────────────────────────────────────────────

function confusionAtThreshold(entries, threshold, scoreFn) {
  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const e of entries) {
    const score = scoreFn(e);
    if (score === null || score === undefined) continue;

    const predicted = score >= threshold ? 'ai' : 'human';
    const actual = e.label;

    if (actual === 'ai' && predicted === 'ai') tp++;
    else if (actual === 'ai' && predicted === 'human') fn++;
    else if (actual === 'human' && predicted === 'ai') fp++;
    else if (actual === 'human' && predicted === 'human') tn++;
  }

  const total = tp + tn + fp + fn;
  const accuracy = total > 0 ? (tp + tn) / total : 0;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { threshold, tp, fp, tn, fn, accuracy, precision, recall, f1, total };
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const raw = JSON.parse(await readFile(RESULTS_PATH, 'utf-8'));
  const dataset = JSON.parse(await readFile(DATASET_PATH, 'utf-8'));
  // results.json is intentionally resumable and can retain rows from older
  // corpora.  Analyze only today's dataset and use its current ground-truth
  // metadata rather than a stale label cached alongside a previous run.
  const allEntries = dataset
    .map((source) => raw[source.videoId] ? { ...raw[source.videoId], ...source } : null)
    .filter((e) => e && !e.error && e.label);

  if (allEntries.length === 0) {
    console.error('❌ No results found. Run the benchmark first.');
    process.exit(1);
  }

  // Detect which providers have data
  const providersWithData = PROVIDER_NAMES.filter((p) =>
    allEntries.some((e) => e[p] && typeof getProviderScore(e, p) === 'number')
  );

  console.log('═'.repeat(80));
  console.log('  MULTI-PROVIDER AI DETECTION BENCHMARK ANALYSIS');
  console.log('═'.repeat(80));
  console.log(`\n  Total entries: ${allEntries.length}`);
  console.log(`  Providers with data: ${providersWithData.map((p) => `${PROVIDER_EMOJI[p]} ${p}`).join('  |  ')}`);

  // Group by label
  const groups = { human: [], ai: [], mixed: [] };
  for (const e of allEntries) {
    const label = e.label || 'mixed';
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }
  console.log(`  Human: ${groups.human.length} | AI: ${groups.ai.length} | Mixed: ${groups.mixed.length}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Per-Provider Distribution Stats
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('─'.repeat(80));
  console.log('  1. PER-PROVIDER SCORE DISTRIBUTION');
  console.log('─'.repeat(80));

  for (const provider of providersWithData) {
    console.log(`\n  ${PROVIDER_EMOJI[provider]} ${provider.toUpperCase()}`);

    for (const [label, entries] of Object.entries(groups)) {
      if (entries.length === 0) continue;
      const scores = entries.map((e) => getProviderScore(e, provider)).filter((v) => typeof v === 'number');
      if (scores.length === 0) {
        console.log(`    ${label.padEnd(6)}: (no data)`);
        continue;
      }
      console.log(
        `    ${label.padEnd(6)} (n=${String(scores.length).padEnd(3)}): ` +
        `min=${fmt(min(scores))}  max=${fmt(max(scores))}  mean=${fmt(mean(scores))}  median=${fmt(median(scores))}  stddev=${fmt(stddev(scores))}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Head-to-Head Comparison Table
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(80));
  console.log('  2. HEAD-TO-HEAD PER-VIDEO COMPARISON');
  console.log('─'.repeat(80));

  // Build header
  const providerCols = providersWithData.map((p) => p.padEnd(8)).join(' ');
  console.log(`\n  ${'VideoId'.padEnd(13)} ${'Label'.padEnd(7)} ${providerCols} ${'Consns'.padEnd(8)} Note`);
  console.log(`  ${'─'.repeat(13)} ${'─'.repeat(7)} ${providersWithData.map(() => '─'.repeat(8)).join(' ')} ${'─'.repeat(8)} ${'─'.repeat(35)}`);

  // Sort: AI first, then mixed, then human
  const labelOrder = { ai: 0, mixed: 1, human: 2 };
  const sorted = [...allEntries].sort((a, b) => {
    const lo = (labelOrder[a.label] ?? 9) - (labelOrder[b.label] ?? 9);
    if (lo !== 0) return lo;
    const cs = (consensusScore(b) ?? 0) - (consensusScore(a) ?? 0);
    return cs;
  });

  for (const e of sorted) {
    const scores = providersWithData.map((p) => {
      const s = getProviderScore(e, p);
      return s !== null ? pct(s).padEnd(8) : '—'.padEnd(8);
    }).join(' ');

    const cs = consensusScore(e);
    const csStr = cs !== null ? pct(cs).padEnd(8) : '—'.padEnd(8);

    // Flag disagreements
    const provScores = providersWithData.map((p) => getProviderScore(e, p)).filter((v) => v !== null);
    const allAgree = provScores.length > 1 &&
      provScores.every((s) => (s >= 0.5) === (provScores[0] >= 0.5));
    const flag = provScores.length > 1 && !allAgree ? '⚡' : '';

    const noteTrunc = (e.note || '').slice(0, 35);
    console.log(`  ${e.videoId.padEnd(13)} ${e.label.padEnd(7)} ${scores} ${csStr} ${noteTrunc} ${flag}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Per-Provider Confusion Matrices
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(80));
  console.log('  3. PER-PROVIDER CONFUSION MATRICES (excludes "mixed")');
  console.log('─'.repeat(80));

  const binaryEntries = allEntries.filter((e) => e.label === 'human' || e.label === 'ai');
  const thresholds = [0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.65, 0.7, 0.8];

  for (const provider of providersWithData) {
    const dataCount = binaryEntries.filter((e) => typeof getProviderScore(e, provider) === 'number').length;
    console.log(`\n  ${PROVIDER_EMOJI[provider]} ${provider.toUpperCase()} (${dataCount} entries with scores)`);

    if (dataCount === 0) {
      console.log('    (no data)');
      continue;
    }

    console.log(`  ${'Thresh'.padEnd(8)} ${'TP'.padEnd(5)} ${'FP'.padEnd(5)} ${'TN'.padEnd(5)} ${'FN'.padEnd(5)} ${'Acc'.padEnd(8)} ${'Prec'.padEnd(8)} ${'Recall'.padEnd(8)} ${'F1'.padEnd(8)}`);
    console.log(`  ${'─'.repeat(8)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)}`);

    let bestF1 = 0, bestThresh = 0.5;
    for (const t of thresholds) {
      const cm = confusionAtThreshold(binaryEntries, t, (e) => getProviderScore(e, provider));
      if (cm.f1 > bestF1) { bestF1 = cm.f1; bestThresh = t; }
      console.log(
        `  ${t.toFixed(2).padEnd(8)} ${String(cm.tp).padEnd(5)} ${String(cm.fp).padEnd(5)} ${String(cm.tn).padEnd(5)} ${String(cm.fn).padEnd(5)} ${pct(cm.accuracy).padEnd(8)} ${pct(cm.precision).padEnd(8)} ${pct(cm.recall).padEnd(8)} ${pct(cm.f1).padEnd(8)}`
      );
    }
    console.log(`  ★ Best F1: ${pct(bestF1)} at threshold ${bestThresh.toFixed(2)}`);
  }

  // Consensus confusion matrix
  console.log(`\n  🏆 CONSENSUS (median of available providers)`);
  const consensusDataCount = binaryEntries.filter((e) => consensusScore(e) !== null).length;
  if (consensusDataCount > 0) {
    console.log(`  ${'Thresh'.padEnd(8)} ${'TP'.padEnd(5)} ${'FP'.padEnd(5)} ${'TN'.padEnd(5)} ${'FN'.padEnd(5)} ${'Acc'.padEnd(8)} ${'Prec'.padEnd(8)} ${'Recall'.padEnd(8)} ${'F1'.padEnd(8)}`);
    console.log(`  ${'─'.repeat(8)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)}`);

    let bestF1 = 0, bestThresh = 0.5;
    for (const t of thresholds) {
      const cm = confusionAtThreshold(binaryEntries, t, consensusScore);
      if (cm.f1 > bestF1) { bestF1 = cm.f1; bestThresh = t; }
      console.log(
        `  ${t.toFixed(2).padEnd(8)} ${String(cm.tp).padEnd(5)} ${String(cm.fp).padEnd(5)} ${String(cm.tn).padEnd(5)} ${String(cm.fn).padEnd(5)} ${pct(cm.accuracy).padEnd(8)} ${pct(cm.precision).padEnd(8)} ${pct(cm.recall).padEnd(8)} ${pct(cm.f1).padEnd(8)}`
      );
    }
    console.log(`  ★ Best F1: ${pct(bestF1)} at threshold ${bestThresh.toFixed(2)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Provider Agreement Analysis
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(80));
  console.log('  4. PROVIDER AGREEMENT ANALYSIS');
  console.log('─'.repeat(80));

  if (providersWithData.length >= 2) {
    let allAgree = 0, majorityAgree = 0, disagree = 0, insufficient = 0;
    const outlierCount = {};
    for (const p of providersWithData) outlierCount[p] = 0;

    for (const e of binaryEntries) {
      const scores = {};
      for (const p of providersWithData) {
        const s = getProviderScore(e, p);
        if (s !== null) scores[p] = s >= 0.5 ? 'ai' : 'human';
      }

      const providers = Object.keys(scores);
      if (providers.length < 2) { insufficient++; continue; }

      const predictions = Object.values(scores);
      const aiCount = predictions.filter((p) => p === 'ai').length;
      const humanCount = predictions.filter((p) => p === 'human').length;

      if (aiCount === predictions.length || humanCount === predictions.length) {
        allAgree++;
      } else if (providers.length >= 3 && (aiCount >= 2 || humanCount >= 2)) {
        majorityAgree++;
        // Find the outlier
        const majorityPrediction = aiCount > humanCount ? 'ai' : 'human';
        for (const [p, pred] of Object.entries(scores)) {
          if (pred !== majorityPrediction) outlierCount[p]++;
        }
      } else {
        disagree++;
      }
    }

    const total = allAgree + majorityAgree + disagree;
    console.log(`\n  Binary entries with ≥2 providers: ${total}`);
    console.log(`  All agree:       ${allAgree} (${total > 0 ? pct(allAgree / total) : '—'})`);
    console.log(`  Majority agree:  ${majorityAgree} (${total > 0 ? pct(majorityAgree / total) : '—'})`);
    console.log(`  Split/disagree:  ${disagree} (${total > 0 ? pct(disagree / total) : '—'})`);
    if (insufficient > 0) console.log(`  Insufficient data: ${insufficient}`);

    if (providersWithData.length >= 3 && majorityAgree > 0) {
      console.log(`\n  Outlier frequency (when majority agrees):`);
      for (const [p, count] of Object.entries(outlierCount)) {
        console.log(`    ${PROVIDER_EMOJI[p]} ${p}: ${count} times outlier`);
      }
    }

    // Pairwise correlation
    console.log(`\n  Pairwise score correlation (Pearson r):`);
    for (let i = 0; i < providersWithData.length; i++) {
      for (let j = i + 1; j < providersWithData.length; j++) {
        const p1 = providersWithData[i];
        const p2 = providersWithData[j];
        const pairs = binaryEntries
          .map((e) => [getProviderScore(e, p1), getProviderScore(e, p2)])
          .filter(([a, b]) => a !== null && b !== null);

        if (pairs.length < 3) {
          console.log(`    ${p1} ↔ ${p2}: insufficient data (${pairs.length} pairs)`);
          continue;
        }

        const xs = pairs.map(([a]) => a);
        const ys = pairs.map(([, b]) => b);
        const r = pearsonR(xs, ys);
        console.log(`    ${p1} ↔ ${p2}: r=${fmt(r, 4)} (${pairs.length} pairs)`);
      }
    }
  } else {
    console.log('\n  (Need ≥2 providers with data for agreement analysis)');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Per-Category Breakdown
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(80));
  console.log('  5. PER-CATEGORY ACCURACY (threshold=0.5, excludes mixed)');
  console.log('─'.repeat(80));

  const categories = [...new Set(binaryEntries.map((e) => e.category))].sort();

  // Header
  const catProvCols = providersWithData.map((p) => p.padEnd(12)).join(' ');
  console.log(`\n  ${'Category'.padEnd(22)} ${'n'.padEnd(4)} ${catProvCols} ${'Consns'.padEnd(12)}`);
  console.log(`  ${'─'.repeat(22)} ${'─'.repeat(4)} ${providersWithData.map(() => '─'.repeat(12)).join(' ')} ${'─'.repeat(12)}`);

  for (const cat of categories) {
    const catEntries = binaryEntries.filter((e) => e.category === cat);
    const cols = providersWithData.map((p) => {
      const cm = confusionAtThreshold(catEntries, 0.5, (e) => getProviderScore(e, p));
      return cm.total > 0 ? `${pct(cm.accuracy)} (F1=${pct(cm.f1)})`.padEnd(12) : '—'.padEnd(12);
    }).join(' ');

    const consCm = confusionAtThreshold(catEntries, 0.5, consensusScore);
    const consCol = consCm.total > 0 ? `${pct(consCm.accuracy)} (F1=${pct(consCm.f1)})`.padEnd(12) : '—'.padEnd(12);

    console.log(`  ${cat.padEnd(22)} ${String(catEntries.length).padEnd(4)} ${cols} ${consCol}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: Recommendations
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '─'.repeat(80));
  console.log('  6. RECOMMENDATIONS');
  console.log('─'.repeat(80));

  console.log('\n  Provider coverage:');
  for (const p of providersWithData) {
    const coverage = binaryEntries.filter((e) => typeof getProviderScore(e, p) === 'number').length;
    console.log(`    ${PROVIDER_EMOJI[p]} ${p}: ${coverage}/${binaryEntries.length} binary entries`);
  }

  // Find best single provider
  let bestProvider = null, bestProviderF1 = 0, bestProviderThresh = 0.5;
  for (const p of providersWithData) {
    for (let t = 0.1; t <= 0.9; t += 0.05) {
      const cm = confusionAtThreshold(binaryEntries, t, (e) => getProviderScore(e, p));
      if (cm.f1 > bestProviderF1) {
        bestProviderF1 = cm.f1;
        bestProvider = p;
        bestProviderThresh = t;
      }
    }
  }

  // Best consensus
  let bestConsensusF1 = 0, bestConsensusThresh = 0.5;
  for (let t = 0.1; t <= 0.9; t += 0.05) {
    const cm = confusionAtThreshold(binaryEntries, t, consensusScore);
    if (cm.f1 > bestConsensusF1) {
      bestConsensusF1 = cm.f1;
      bestConsensusThresh = t;
    }
  }

  console.log(`\n  Best single provider:  ${PROVIDER_EMOJI[bestProvider]} ${bestProvider} → F1=${pct(bestProviderF1)} at threshold ${bestProviderThresh.toFixed(2)}`);
  console.log(`  Best consensus:        🏆 median → F1=${pct(bestConsensusF1)} at threshold ${bestConsensusThresh.toFixed(2)}`);

  if (bestConsensusF1 > bestProviderF1) {
    console.log(`\n  💡 Consensus (ensemble) outperforms any single provider. Consider using median-of-providers in production.`);
  } else {
    console.log(`\n  💡 ${bestProvider} alone matches or beats the ensemble. The other providers may not add value at the cost of latency/complexity.`);
  }

  // False positive analysis
  console.log(`\n  🎯 False positive analysis (threshold=0.5, most important for creator fairness):`);
  for (const p of providersWithData) {
    const fps = groups.human.filter((e) => {
      const s = getProviderScore(e, p);
      return s !== null && s >= 0.5;
    });
    console.log(`    ${PROVIDER_EMOJI[p]} ${p}: ${fps.length} FPs out of ${groups.human.length} human videos`);
    for (const fp of fps) {
      console.log(`      → ${fp.videoId} (${fp.note?.slice(0, 50)}) = ${pct(getProviderScore(fp, p))}`);
    }
  }

  console.log('\n');
}

// ── Pearson correlation ─────────────────────────────────────────────────────────

function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : 0;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
