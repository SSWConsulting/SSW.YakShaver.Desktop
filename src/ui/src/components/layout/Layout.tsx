import { Outlet } from "react-router-dom";
import Sidebar from "./sidebar";

// #998: Layout previously mounted `useWorkflowNavigation()` here (its default
// listener subscribed to every `workflow.onProgressNeo` event), which
// force-navigated to `/workflow` on every progress tick of an in-progress
// run — not just when the run started. Since Layout wraps every route, that
// yanked the user off any page (e.g. Shaves) they'd intentionally navigated
// to, repeatedly, for the life of the run, and fought manual navigation back
// into a specific shave's `/workflow/:shaveId` outcome view. The intentional
// "jump to the live workflow view" navigation already happens at the two
// points a run actually starts — ScreenRecorder and VideoPreviewModal each
// call `useWorkflowNavigation({ listen: false })`'s `navigateToWorkflow()`
// explicitly — so no global listener is needed here.
export function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="z-10 flex-1 ml-[18rem] min-w-0 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
