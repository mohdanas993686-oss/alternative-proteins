import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import NewAnalysis from "@/pages/NewAnalysis";
import Samples from "@/pages/Samples";
import SampleReport from "@/pages/SampleReport";
import Compare from "@/pages/Compare";
import ModelPerformance from "@/pages/ModelPerformance";
import AgentPage from "@/pages/AgentPage";
import Rules from "@/pages/Rules";
import Roadmap from "@/pages/Roadmap";
import Blender from "@/pages/Blender";
import CostHub from "@/pages/CostHub";
import StoryMode from "@/pages/StoryMode";
import ReferencePrices from "@/pages/ReferencePrices";
import { CurrencyProvider } from "@/lib/cost";

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <TooltipProvider delayDuration={150}>
        <CurrencyProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/new" element={<NewAnalysis />} />
                <Route path="/samples" element={<Samples />} />
                <Route path="/samples/:id" element={<SampleReport />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/blender" element={<Blender />} />
                <Route path="/hub" element={<CostHub />} />
                <Route path="/story" element={<StoryMode />} />
                <Route path="/cost-comparison" element={<ReferencePrices />} />
                <Route path="/models" element={<ModelPerformance />} />
                <Route path="/agent" element={<AgentPage />} />
                <Route path="/rules" element={<Rules />} />
                <Route path="/roadmap" element={<Roadmap />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster position="top-right" richColors />
        </CurrencyProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
