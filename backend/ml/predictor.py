import json
import joblib
import numpy as np
from ml.train import MODEL_DIR, METRICS
from ml.synth import WAVELENGTHS

_cache = {"models": None, "metrics": None}


def reload():
    _cache["models"], _cache["metrics"] = None, None


def load_metrics():
    if _cache["metrics"] is None and METRICS.exists():
        _cache["metrics"] = json.loads(METRICS.read_text())
    return _cache["metrics"]


def _models():
    if _cache["models"] is None:
        _cache["models"] = {p.stem: joblib.load(p) for p in MODEL_DIR.glob("*.joblib")}
    return _cache["models"]


def to_grid(spectrum, wavelengths=None):
    s = np.asarray(spectrum, dtype=float)
    if wavelengths is None:
        if len(s) == len(WAVELENGTHS):
            return s
        wavelengths = np.linspace(900, 1700, len(s))
    w = np.asarray(wavelengths, dtype=float)
    order = np.argsort(w)
    return np.interp(WAVELENGTHS, w[order], s[order])


def predict(spectrum, byproduct):
    x = to_grid(spectrum).reshape(1, -1)
    best = (load_metrics() or {}).get("best", {})
    out = []
    for key, bundle in _models().items():
        target, bp = key.split("__")
        if bp != byproduct:
            continue
        m = best.get(f"{target}|{bp}", {})
        val = float(np.ravel(bundle["model"].predict(x))[0])
        out.append({"target": target, "value": round(max(val, 0.0), 3), "error": round(m.get("rmse", 0), 3),
                    "model": m.get("algo", "?"), "r2": round(m.get("r2", 0), 3), "reliable": bool(m.get("reliable", False))})
    return out
