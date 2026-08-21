DROP TABLE IF EXISTS video_analyses;

CREATE TABLE video_analyses (
  video_id TEXT PRIMARY KEY,
  overall_score REAL NOT NULL,
  sentence_scores TEXT, -- JSON array of {sentence, score}
  transcript_length INTEGER,
  analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
  transcript_preview TEXT -- first 200 chars of transcript
);

CREATE INDEX idx_analyzed_at ON video_analyses(analyzed_at);
