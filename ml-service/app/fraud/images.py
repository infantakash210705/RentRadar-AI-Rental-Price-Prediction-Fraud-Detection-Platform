"""Image fingerprints: perceptual hash (robust to resize/recompress) + a compact embedding
(colour histogram + 8x8 luminance thumbnail) compared with cosine similarity."""
from __future__ import annotations

import io

import imagehash
import numpy as np
from PIL import Image, UnidentifiedImageError

MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # decompression-bomb guard


class BadImage(ValueError):
    pass


def open_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise BadImage(f"Cannot decode image: {e}") from e
    return img.convert("RGB")


def _unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def embedding(img: Image.Image) -> list[float]:
    hsv = np.asarray(img.resize((64, 64)).convert("HSV"), dtype=np.float32)
    hist = np.concatenate([np.histogram(hsv[..., c], bins=8, range=(0, 256))[0] for c in range(3)]).astype(np.float32)
    gray = np.asarray(img.convert("L").resize((8, 8), Image.BILINEAR), dtype=np.float32).ravel()
    gray = gray - gray.mean()
    vec = np.concatenate([_unit(hist) * 0.5, _unit(gray)])
    return [round(float(x), 4) for x in _unit(vec)]


def analyze(data: bytes) -> dict:
    img = open_image(data)
    w, h = img.size
    return {"phash": str(imagehash.phash(img)), "embedding": embedding(img), "width": w, "height": h}


def hamming(h1: str, h2: str) -> int:
    return imagehash.hex_to_hash(h1) - imagehash.hex_to_hash(h2)


def cosine(a, b) -> float:
    a, b = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a @ b / d) if d else 0.0
