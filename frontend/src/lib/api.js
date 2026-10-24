import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API });

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join("; ");
  return d || e?.message || "Something went wrong";
};

export async function streamSSE(path, body, onEvent) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.detail || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

export const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(d));
export const fmtBig = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());

export const BP = {
  guar_meal: { label: "Guar meal", color: "#15803d" },
  groundnut_cake: { label: "Groundnut cake", color: "#b45309" },
  almond_cake: { label: "Almond cake", color: "#9a5b3c" },
  rice_bran: { label: "Rice bran", color: "#ca8a04" },
  pulse_residue: { label: "Pulse residue", color: "#0f766e" },
};

export const TARGET_LABEL = {
  protein: "Crude protein", oil: "Residual oil", moisture: "Moisture", fibre_total: "Total fibre",
  fibre_soluble: "Soluble fibre", fibre_insoluble: "Insoluble fibre", gum: "Residual gum",
  phytate: "Phytate", tannins: "Tannins", trypsin_inhibitor: "Trypsin inhibitor",
};
