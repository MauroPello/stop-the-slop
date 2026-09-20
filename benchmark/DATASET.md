# Benchmark corpus provenance

`dataset.json` contains 1,000 public YouTube watch URLs that were checked by
`build-dataset.mjs` at build time. A row is included only if `yt-dlp` could
retrieve an English subtitle track with at least 50 characters.

The labels are provenance labels, not a detector's prediction:

- `human`: a TED speaker presentation, where the visible speaker is a known
  human performer.
- `ai`: the video title explicitly declares AI-generated, AI-made, AI-narrated,
  AI-assisted, or AI-animation content work.

There is no `mixed` class. The former mixed rows were reviewed individually:
identified AI-assisted/AI-made films, animations, trailers, and music videos
move to `ai`; tools, tutorials, news, reviews, and process commentary are
dropped. This keeps the benchmark binary: 500 human and 500 AI-content works.

The builder preserves rows that already have a stored transcript and verifies
captions only for new candidates. It avoids treating transient YouTube rate
limits as permanent caption absence.

This avoids the prior, invalid practice of labeling a video `ai` merely because
its prose is structured, faceless, polished, or listicle-like. Availability and
captions are inherently time-sensitive; rerun the builder before a new benchmark
run to refresh the corpus.
