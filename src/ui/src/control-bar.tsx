import { createRoot } from "react-dom/client";
import RecordingControlBar from "./components/recording/RecordingControlBar.tsx";
import "./App.css";

createRoot(document.getElementById("root")!).render(<RecordingControlBar />);
