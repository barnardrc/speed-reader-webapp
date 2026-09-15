from __future__ import annotations

import re

EM_DASH = "\u2014"


def normalize_text(text: str) -> str:
    if not text:
        return ""
    normalized = text.replace("--", EM_DASH)
    return re.sub(rf"\s*{EM_DASH}\s*", f"{EM_DASH} ", normalized)


def process_headers(words: list[str]) -> list[str]:
    """Merge consecutive ALL-CAPS / numbered header tokens into one chunk."""
    processed: list[str] = []
    stack: list[str] = []

    for word in words:
        is_caps = word.isupper() and any(ch.isalpha() for ch in word)
        has_quote = '"' in word or "'" in word
        is_number = word.replace(".", "").isdigit() and len(stack) > 0

        if (is_caps or is_number) and not has_quote:
            stack.append(word)
            continue

        if stack:
            if len(stack) <= 10:
                processed.append(" ".join(stack))
            else:
                processed.append(stack[0])
                processed.extend(stack[1:])
            stack = []

        processed.append(word)

    if stack:
        if len(stack) <= 10:
            processed.append(" ".join(stack))
        else:
            processed.append(stack[0])
            processed.extend(stack[1:])

    return processed
