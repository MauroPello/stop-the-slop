CREATE TABLE IF NOT EXISTS video_analyses (
  video_id TEXT PRIMARY KEY,
  overall_score REAL NOT NULL,
  sentence_scores TEXT, -- JSON array of {sentence, score}
  transcript_length INTEGER,
  analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
  transcript_preview TEXT -- first 200 chars of transcript
);

CREATE INDEX IF NOT EXISTS idx_analyzed_at ON video_analyses(analyzed_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);

