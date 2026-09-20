#!/usr/bin/env python3
"""Fast persistent JSONL inference worker for TrustSafeAI/RADAR-Vicuna-7B."""

import json
import os
import sys

import torch
import torch.nn.functional as F
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL_ID = "TrustSafeAI/RADAR-Vicuna-7B"
MAX_TOKENS = 512  # Official RADAR example uses a single truncated 512-token window.


def main():
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    load_kwargs = {"token": token} if token else {}
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, **load_kwargs)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID, **load_kwargs).eval().to(device)
    print(json.dumps({"ready": True, "device": str(device)}), flush=True)

    for line in sys.stdin:
        try:
            text = json.loads(line).get("text", "")
            if not text.strip():
                raise ValueError("Text is empty after normalization")
            encoded = tokenizer(text, truncation=True, max_length=MAX_TOKENS, return_tensors="pt")
            encoded = {key: value.to(device) for key, value in encoded.items()}
            with torch.inference_mode():
                # RADAR's official implementation defines logits[:, 0] as P(AI).
                probabilities = F.softmax(model(**encoded).logits, dim=-1)[0].float().cpu()
            print(json.dumps({
                "provider": "radar",
                "model": MODEL_ID,
                "score": float(probabilities[0]),
                "classProbabilities": {"ai": float(probabilities[0]), "human": float(probabilities[1])},
                "tokenLimit": MAX_TOKENS,
                "device": str(device),
            }), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
