"""Generate the synthetic training dataset (DEMO DATA). Run: python -m ml.generate_data"""
from pathlib import Path
import numpy as np
import pandas as pd
from ml.synth import BYPRODUCTS, WAVELENGTHS, sample_targets, spectrum_from_targets

DATA_DIR = Path(__file__).parent / "data"
DATASET = DATA_DIR / "synthetic_dataset.csv"


def generate(seed=42, path=DATASET):
    rng = np.random.default_rng(seed)
    rows = []
    for bp, p in BYPRODUCTS.items():
        for i in range(p["n"]):
            batch_no = i // 5 + 1
            batch_offset = np.sin(batch_no * 1.7) * 0.02
            t = sample_targets(rng, bp)
            spec = spectrum_from_targets(rng, t, n_scans=3, batch_offset=batch_offset)
            row = {"sample_id": f"{bp[:3].upper()}-{i + 1:03d}", "batch_id": f"{bp[:3].upper()}-B{batch_no:02d}",
                   "byproduct": bp, **{k: round(float(v), 4) for k, v in t.items()}}
            row.update({f"{w}": round(float(a), 6) for w, a in zip(WAVELENGTHS, spec)})
            rows.append(row)
    df = pd.DataFrame(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    return df


if __name__ == "__main__":
    d = generate()
    print(f"Wrote {len(d)} samples x {len(WAVELENGTHS)} wavelengths to {DATASET}")
