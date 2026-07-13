import { useLocation, useParams } from "react-router-dom";
import { Heading } from "@/components/typography/heading-tag";
import { Cloud360LiveView } from "../components/cloud360/Cloud360LiveView";
import { FinalResultPanel } from "../components/workflow/FinalResultPanel";
import { ShaveOutcomeView } from "../components/workflow/ShaveOutcomeView";
import { WorkflowProgressPanel } from "../components/workflow/WorkflowProgressPanel";

export function WorkflowPage() {
  // #821: when reached by navigation (`/workflow/:shaveId`), render the persisted outcome for
  // that shave. With no id (the live run just after recording) keep the original live behaviour.
  const { shaveId } = useParams<{ shaveId?: string }>();
  const location = useLocation();
  const is360 = (location.state as { backend?: string } | null)?.backend === "cloud-360";

  return (
    <main className="z-10 flex flex-col p-8 h-full gap-6 w-full min-w-0">
      <Heading>Workflow Progress</Heading>
      {shaveId ? (
        <ShaveOutcomeView shaveId={shaveId} />
      ) : is360 ? (
        // Constrain the width and centre the live view (the parent is a
        // full-width flex column). The view clears itself between recordings, so
        // it does not need a remount key here.
        <div className="flex min-h-0 w-full min-w-0 max-w-3xl flex-1 self-center">
          <Cloud360LiveView />
        </div>
      ) : (
        <>
          <WorkflowProgressPanel />
          <FinalResultPanel />
        </>
      )}
    </main>
  );
}
