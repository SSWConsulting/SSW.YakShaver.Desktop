import { createRoot } from "react-dom/client";
import RegionSelector from "./components/recording/RegionSelector.tsx";
import "./App.css";

createRoot(document.getElementById("root")!).render(<RegionSelector />);
