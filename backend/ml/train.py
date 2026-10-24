"""Train NIR calibration models (PLSR baseline vs SVR vs Random Forest), per target and per by-product.
Run: python -m ml.train
"""
import json
from datetime import datetime, timezone
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.cross_decomposition import PLSRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.svm import SVR
from sklearn.preprocessing import StandardScaler
from sklearn.compose import TransformedTargetRegressor
from sklearn.pipeline import Pipeline
from sklearn.model_selection import GroupShuffleSplit, GroupKFold, GridSearchCV, cross_val_predict
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from ml.preprocess import preprocessor
from ml.synth import TARGETS
from ml.generate_data import DATASET, generate

MODEL_DIR = Path(__file__).parent / "models"
METRICS = MODEL_DIR / "metrics.json"
ANF_TARGETS = {"phytate", "tannins", "trypsin_inhibitor"}


def spectral_columns(df):
    cols = []
    for c in df.columns:
        try:
            w = float(str(c).replace("w_", ""))
            if 800 <= w <= 2600:
                cols.append(c)
        except ValueError:
            pass
    return cols


def metrics(y, p):
    y, p = np.asarray(y), np.asarray(p)
    return {"rmse": float(np.sqrt(mean_squared_error(y, p))), "mae": float(mean_absolute_error(y, p)),
            "r2": float(r2_score(y, p)) if len(y) > 1 else 0.0, "bias": float(np.mean(p - y))}


def build_models(n_train):
    max_pc = max(2, min(12, n_train // 3))
    pls = GridSearchCV(Pipeline([("prep", preprocessor()), ("m", PLSRegression(scale=False))]),
                       {"m__n_components": list(range(2, max_pc + 1))}, scoring="neg_root_mean_squared_error",
                       cv=GroupKFold(3))
    svr = TransformedTargetRegressor(
        regressor=Pipeline([("prep", preprocessor()), ("sc", StandardScaler()), ("m", SVR(C=10, gamma="scale", epsilon=0.05))]),
        transformer=StandardScaler())
    rf = Pipeline([("prep", preprocessor()), ("m", RandomForestRegressor(n_estimators=100, max_features="sqrt", random_state=0, n_jobs=-1))])
    return {"PLSR": pls, "SVR": svr, "RandomForest": rf}


def reliable(target, r2):
    return r2 >= (0.8 if target in ANF_TARGETS else 0.7)


def _fit_predict(model, X, y, groups, fit_params):
    model.fit(X, y, **fit_params)
    return model


def train_dataset(df, progress=None, save=True, model_dir=MODEL_DIR):
    wcols = spectral_columns(df)
    if "batch_id" not in df.columns:
        df["batch_id"] = df.get("sample_id", pd.Series(range(len(df)))).astype(str)
    targets = [t for t in TARGETS if t in df.columns]
    jobs = [(t, bp) for t in targets for bp in sorted(df["byproduct"].unique())
            if not (t == "gum" and bp != "guar_meal")]
    results, best = [], {}
    model_dir.mkdir(parents=True, exist_ok=True)
    for i, (t, bp) in enumerate(jobs):
        sub = df[(df["byproduct"] == bp) & df[t].notna()]
        if len(sub) < 12 or sub["batch_id"].nunique() < 4:
            continue
        X, y, g = sub[wcols].values, sub[t].values, sub["batch_id"].values
        tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=7).split(X, y, g))
        cands = {}
        for name, model in build_models(len(tr)).items():
            fit_kw = {"groups": g[tr]} if name == "PLSR" else {}
            cv_pred = cross_val_predict(model, X[tr], y[tr], groups=g[tr], cv=GroupKFold(3),
                                        params=fit_kw or None).ravel()
            model.fit(X[tr], y[tr], **fit_kw)
            pred = np.ravel(model.predict(X[te]))
            m = metrics(y[te], pred)
            m.update({"target": t, "byproduct": bp, "algo": name, "cv_rmse": metrics(y[tr], cv_pred)["rmse"],
                      "n_train": int(len(tr)), "n_test": int(len(te))})
            if name == "PLSR":
                m["n_components"] = int(model.best_params_["m__n_components"])
            cands[name] = (model, m, pred)
            results.append(m)
        name = min(cands, key=lambda k: cands[k][1]["cv_rmse"])
        model, m, pred = cands[name]
        for r in results:
            if r["target"] == t and r["byproduct"] == bp:
                r["selected"] = r["algo"] == name
        best[f"{t}|{bp}"] = {**m, "reliable": reliable(t, m["r2"]), "measured": [round(float(v), 3) for v in y[te]],
                             "predicted": [round(float(v), 3) for v in pred],
                             "test_ids": [str(s) for s in sub["sample_id"].values[te]] if "sample_id" in sub else []}
        if save:
            est = model.best_estimator_ if hasattr(model, "best_estimator_") else model
            joblib.dump({"model": est, "wavelengths": [float(str(c).replace("w_", "")) for c in wcols]},
                        model_dir / f"{t}__{bp}.joblib")
        if progress:
            progress((i + 1) / len(jobs), f"Trained {t} / {bp} (best: {name})")
    out = {"trained_at": datetime.now(timezone.utc).isoformat(), "n_samples": int(len(df)),
           "n_wavelengths": len(wcols), "test_fraction": 0.2, "split": "GroupShuffleSplit by batch_id",
           "preprocessing": "SNV + Savitzky-Golay (window 15, poly 2, 1st derivative)",
           "results": results, "best": best, "note": "Trained on synthetic data. Metrics are not scientifically valid for real samples."}
    if save:
        METRICS.write_text(json.dumps(out))
    return out


def train_all(progress=None):
    if not DATASET.exists():
        generate()
    return train_dataset(pd.read_csv(DATASET), progress=progress)


if __name__ == "__main__":
    r = train_all(lambda p, msg: print(f"[{p * 100:5.1f}%] {msg}"))
    print(f"Done. {len(r['best'])} best models saved to {MODEL_DIR}")
