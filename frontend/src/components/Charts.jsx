import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { useTheme } from "next-themes";

const PlotBase = createPlotlyComponent(Plotly);

export const Plot = ({ data, layout = {}, height = 320, testid }) => {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const fg = dark ? "#e7e3da" : "#1c2b22";
  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(20,60,40,0.09)";
  const axis = { gridcolor: grid, zerolinecolor: grid, linecolor: grid, ...{} };
  return (
    <div data-testid={testid} className="w-full">
      <PlotBase
        data={data}
        layout={{
          autosize: true, height, margin: { l: 52, r: 16, t: 16, b: 46 },
          paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
          font: { family: "Public Sans, sans-serif", color: fg, size: 12 },
          legend: { orientation: "h", y: -0.22 },
          hoverlabel: { font: { family: "JetBrains Mono, monospace" } },
          ...layout,
          xaxis: { ...axis, ...(layout.xaxis || {}) },
          yaxis: { ...axis, ...(layout.yaxis || {}) },
          polar: layout.polar ? { bgcolor: "rgba(0,0,0,0)", ...layout.polar,
            radialaxis: { gridcolor: grid, linecolor: grid, ...(layout.polar.radialaxis || {}) },
            angularaxis: { gridcolor: grid, linecolor: grid, ...(layout.polar.angularaxis || {}) } } : undefined,
        }}
        config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] }}
        useResizeHandler
        style={{ width: "100%" }}
      />
    </div>
  );
};

export const SpectrumChart = ({ wavelengths, spectrum, height = 280, testid = "spectrum-chart" }) => (
  <Plot
    testid={testid}
    height={height}
    data={[{ x: wavelengths, y: spectrum, type: "scatter", mode: "lines", line: { color: "#15803d", width: 2 },
      fill: "tozeroy", fillcolor: "rgba(21,128,61,0.08)", name: "Absorbance", hovertemplate: "%{x:.0f} nm<br>%{y:.4f}<extra></extra>" }]}
    layout={{
      xaxis: { title: { text: "Wavelength (nm)" }, range: [900, 1700] },
      yaxis: { title: { text: "Absorbance (log 1/R)" } },
      showlegend: false,
      shapes: [1190, 1450, 1510, 1210].map((x) => ({ type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1, line: { color: "rgba(180,83,9,0.35)", dash: "dot", width: 1 } })),
      annotations: [[1450, "H₂O"], [1510, "N-H protein"], [1210, "C-H oil"]].map(([x, t]) => ({ x, yref: "paper", y: 1.02, text: t, showarrow: false, font: { size: 10, color: "#b45309" } })),
    }}
  />
);
