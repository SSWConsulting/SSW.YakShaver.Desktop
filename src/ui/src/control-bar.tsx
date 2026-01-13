import { createRoot } from "react-dom/client";
import RecordingControlBar from "./components/recording/RecordingControlBar.tsx";

import "./App.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<RecordingControlBar />);
}
