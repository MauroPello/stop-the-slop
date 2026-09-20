#!/usr/bin/env python3
"""Persistent JSONL inference worker for wasitaigeneratedcom/ai-text-detector-small."""

import json
import os
import re
import sys

import torch
import torch.nn as nn
from transformers import AutoConfig, AutoModel, AutoTokenizer, PreTrainedModel

MODEL_ID = "wasitaigeneratedcom/ai-text-detector-small"
MAX_TOKENS = 768
LABELS = ["human", "ai", "ai_edited", "humanized"]


class AIDetectionModel(PreTrainedModel):
    """Model head published in the model card, retained for checkpoint compatibility."""

    config_class = AutoConfig
    _tied_weights_keys = []

    @property
    def all_tied_weights_keys(self):
        return {}

    def __init__(self, config):
        super().__init__(config)
        self.model = AutoModel.from_config(config)
        self.classifier = nn.Linear(config.hidden_size, getattr(config, "detector_num_labels", 4))

    def forward(self, input_ids, attention_mask=None, **kwargs):
        output = self.model(input_ids, attention_mask=attention_mask)
        hidden = output[0]
        mask = attention_mask.unsqueeze(-1).float()
        pooled = (hidden * mask).sum(1) / mask.sum(1).clamp_min(1)
        return self.classifier(pooled)


def sentence_chunks(text, tokenizer):
    """Split long transcripts at sentence boundaries, keeping each chunk ≤768 tokens."""
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    if not sentences:
        return []
    chunks, current, current_tokens = [], [], 0
    for sentence in sentences:
        token_count = len(tokenizer.encode(sentence, add_special_tokens=False))
        if current and current_tokens + token_count + 2 > MAX_TOKENS:
            chunks.append(" ".join(current))
            current, current_tokens = [], 0
        if token_count + 2 > MAX_TOKENS:
            if current:
                chunks.append(" ".join(current))
                current, current_tokens = [], 0
            token_ids = tokenizer.encode(sentence, add_special_tokens=False)
            for start in range(0, len(token_ids), MAX_TOKENS - 2):
                chunks.append(tokenizer.decode(token_ids[start:start + MAX_TOKENS - 2], skip_special_tokens=True))
        else:
            current.append(sentence)
            current_tokens += token_count
    if current:
        chunks.append(" ".join(current))
    return chunks


def main():
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    load_kwargs = {"token": token} if token else {}
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, **load_kwargs)
    model = AIDetectionModel.from_pretrained(MODEL_ID, **load_kwargs).eval().to(device)
    print(json.dumps({"ready": True, "device": str(device)}), flush=True)

    for line in sys.stdin:
        try:
            payload = json.loads(line)
            chunks = sentence_chunks(payload.get("text", ""), tokenizer)
            if not chunks:
                raise ValueError("Text is empty after normalization")
            weighted_probs = torch.zeros(len(LABELS), device=device)
            total_weight = 0
            with torch.inference_mode():
                for chunk in chunks:
                    encoded = tokenizer(chunk, truncation=True, max_length=MAX_TOKENS, return_tensors="pt")
                    encoded = {key: value.to(device) for key, value in encoded.items()}
                    probabilities = torch.softmax(model(**encoded), dim=-1)[0].cpu()
                    weight = int(encoded["attention_mask"].sum().item())
                    weighted_probs += probabilities.to(device) * weight
                    total_weight += weight
            probabilities = weighted_probs / total_weight
            class_probabilities = {label: float(probability) for label, probability in zip(LABELS, probabilities.cpu())}
            print(json.dumps({
                "provider": "wasitaigenerated",
                "model": MODEL_ID,
                "score": 1 - class_probabilities["human"],
                "classProbabilities": class_probabilities,
                "chunkCount": len(chunks),
                "decisionThreshold": 0.976,
                "device": str(device),
            }), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
