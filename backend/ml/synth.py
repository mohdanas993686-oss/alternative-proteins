"""Synthetic NIR spectra + reference values for protein-rich by-products (DEMO DATA)."""
import numpy as np

WAVELENGTHS = np.round(np.linspace(900, 1700, 256), 2)

BYPRODUCTS = {
    "guar_meal": {"label": "Guar meal", "n": 50, "protein": (42, 55), "oil": (3, 6), "moisture": (7, 11),
                  "fibre_total": (14, 22), "sol_frac": (0.25, 0.4), "gum": (5, 12), "phytate": (12, 22),
                  "tannins": (2, 6), "trypsin_inhibitor": (6, 15), "lectins": (2, 8), "saponins": (3, 9),
                  "allergens": []},
    "groundnut_cake": {"label": "Groundnut cake", "n": 55, "protein": (44, 54), "oil": (6, 11), "moisture": (6, 10),
                       "fibre_total": (9, 15), "sol_frac": (0.1, 0.2), "gum": (0, 0.3), "phytate": (14, 24),
                       "tannins": (3, 8), "trypsin_inhibitor": (10, 22), "lectins": (4, 12), "saponins": (1, 4),
                       "allergens": ["peanut"]},
    "almond_cake": {"label": "Almond cake", "n": 40, "protein": (34, 48), "oil": (8, 16), "moisture": (5, 9),
                    "fibre_total": (15, 28), "sol_frac": (0.1, 0.2), "gum": (0, 0.3), "phytate": (10, 20),
                    "tannins": (4, 12), "trypsin_inhibitor": (1, 5), "lectins": (1, 4), "saponins": (0.5, 2),
                    "allergens": ["almond"]},
    "rice_bran": {"label": "Rice bran", "n": 60, "protein": (12, 17), "oil": (14, 22), "moisture": (8, 13),
                  "fibre_total": (20, 32), "sol_frac": (0.08, 0.15), "gum": (0, 0.3), "phytate": (45, 75),
                  "tannins": (1, 4), "trypsin_inhibitor": (2, 8), "lectins": (1, 5), "saponins": (0.5, 2),
                  "allergens": []},
    "pulse_residue": {"label": "Pulse-processing residue", "n": 45, "protein": (18, 30), "oil": (1, 3),
                      "moisture": (8, 12), "fibre_total": (30, 50), "sol_frac": (0.15, 0.3), "gum": (0, 0.5),
                      "phytate": (8, 16), "tannins": (3, 10), "trypsin_inhibitor": (5, 20), "lectins": (3, 10),
                      "saponins": (2, 8), "allergens": ["pulse"]},
}

TARGETS = ["protein", "oil", "moisture", "fibre_total", "fibre_soluble", "fibre_insoluble", "gum",
           "phytate", "tannins", "trypsin_inhibitor"]
LAB_ONLY = ["lectins", "saponins"]


def _g(c, w):
    return np.exp(-0.5 * ((WAVELENGTHS - c) / w) ** 2)


BANDS = {
    "water": 0.9 * _g(1450, 45) + 0.35 * _g(1190, 40) + 0.2 * _g(970, 30),
    "protein": 0.6 * _g(1510, 50) + 0.3 * _g(1180, 35) + 0.25 * _g(1020, 30) + 0.2 * _g(1680, 25),
    "oil": 0.7 * _g(1210, 25) + 0.5 * _g(1395, 30) + 0.4 * _g(1660, 30),
    "fibre_ins": 0.5 * _g(1490, 60) + 0.3 * _g(1590, 40) + 0.2 * _g(1360, 40),
    "fibre_sol": 0.4 * _g(1440, 50) + 0.35 * _g(1560, 35),
    "gum": 0.5 * _g(1580, 30) + 0.3 * _g(1100, 35),
    "phytate": 0.05 * _g(1250, 20),
    "tannins": 0.06 * _g(1640, 30),
    "trypsin_inhibitor": 0.03 * _g(1530, 25),
}


def sample_targets(rng, bp):
    p = BYPRODUCTS[bp]
    u = lambda k: rng.uniform(*p[k])
    protein = u("protein")
    # mild inverse relation protein vs fibre
    lo, hi = p["fibre_total"]
    pf = (protein - p["protein"][0]) / (p["protein"][1] - p["protein"][0])
    fibre = np.clip(hi - pf * (hi - lo) + rng.normal(0, (hi - lo) * 0.2), lo * 0.9, hi * 1.1)
    sol = fibre * u("sol_frac")
    tia = np.clip(u("trypsin_inhibitor") * (0.8 + 0.4 * pf), 0.2, None)
    return {
        "protein": protein, "oil": u("oil"), "moisture": u("moisture"), "fibre_total": fibre,
        "fibre_soluble": sol, "fibre_insoluble": fibre - sol, "gum": u("gum"), "phytate": u("phytate"),
        "tannins": u("tannins"), "trypsin_inhibitor": tia, "lectins": u("lectins"), "saponins": u("saponins"),
    }


def spectrum_from_targets(rng, t, n_scans=3, batch_offset=0.0):
    pure = (0.2 + t["moisture"] / 100 * BANDS["water"] + t["protein"] / 100 * BANDS["protein"]
            + t["oil"] / 100 * BANDS["oil"] + t["fibre_insoluble"] / 100 * BANDS["fibre_ins"]
            + t["fibre_soluble"] / 100 * BANDS["fibre_sol"] + t["gum"] / 100 * BANDS["gum"]
            + t["phytate"] / 1000 * BANDS["phytate"] + t["tannins"] / 1000 * BANDS["tannins"]
            + t["trypsin_inhibitor"] / 1000 * BANDS["trypsin_inhibitor"])
    a, b, c = rng.normal(1, 0.08), rng.normal(batch_offset, 0.03), rng.normal(0, 0.02)
    slope = (WAVELENGTHS - 1300) / 800
    scans = []
    for _ in range(n_scans):
        s = (a * rng.normal(1, 0.01)) * pure + b + rng.normal(0, 0.004) + c * slope
        scans.append(s + rng.normal(0, 0.0015, size=pure.shape))
    return np.mean(scans, axis=0)


def simulate_scan(bp, seed=None):
    rng = np.random.default_rng(seed)
    t = sample_targets(rng, bp)
    return spectrum_from_targets(rng, t), t
