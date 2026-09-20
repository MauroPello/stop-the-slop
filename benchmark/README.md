# Benchmark runner

The benchmark compares TypeSafe Jev, Gemini, and the local open-weights
[`wasitaigeneratedcom/ai-text-detector-small`](https://huggingface.co/wasitaigeneratedcom/ai-text-detector-small)
(`tropa-mini`, displayed in results as **WasItAiGenerated.com**) and
TrustSafeAI's RADAR-Vicuna-7B detector against the caption-verified dataset.

## Local detector setup

WasItAiGenerated.com is run locally through Python; no third-party detection API is
called. Create an environment and install its CPU dependencies once:

```bash
cd benchmark
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Set `PYTHON=.venv/bin/python` when running the benchmark. The model is public,
but an optional `HF_TOKEN` (or `HUGGINGFACE_HUB_TOKEN`) lets Hugging Face
authenticate the initial model download. Keep that value in your shell or secret
manager, never in a tracked file.

```bash
HF_TOKEN=… PYTHON=.venv/bin/python npm run run:wasitai
HF_TOKEN=… PYTHON=.venv/bin/python npm run run:radar
```

The runner splits long transcripts at sentence boundaries into at most 768-token
chunks and reports the length-weighted `1 - P(human)` score. The model card's
conservative published operating threshold is `0.976`; the analyzer also shows
the model-independent threshold sweep used for cross-provider comparison.

RADAR is configured for its official, fastest evaluation mode: one truncated
512-token window per transcript. Its model card limits use to non-commercial
activities, so this integration is for benchmark/research evaluation only.
