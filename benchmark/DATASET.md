# Benchmark corpus provenance

`dataset.json` contains 500 public YouTube watch URLs that were checked by
`build-dataset.mjs` at build time. A row is included only if `yt-dlp` could
retrieve an English subtitle track with at least 50 characters.

The labels are provenance labels, not a detector's prediction:

- `human`: a TED speaker presentation, where the visible speaker is a known
  human performer.
- `ai`: the video title explicitly declares AI-generated, AI-made, AI-narrated,
  or AI animation content.
- `mixed`: the title explicitly declares AI-assisted or AI-made production.

This avoids the prior, invalid practice of labeling a video `ai` merely because
its prose is structured, faceless, polished, or listicle-like. Availability and
captions are inherently time-sensitive; rerun the builder before a new benchmark
run to refresh the corpus.
