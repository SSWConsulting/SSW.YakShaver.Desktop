import { useParams } from "react-router-dom";
import { Heading } from "@/components/typography/heading-tag";
import { FinalResultPanel } from "../components/workflow/FinalResultPanel";
import { ShaveOutcomeView } from "../components/workflow/ShaveOutcomeView";
import { WorkflowProgressPanel } from "../components/workflow/WorkflowProgressPanel";

export function WorkflowPage() {
  // #821: when reached by navigation (`/workflow/:shaveId`), render the persisted outcome for
  // that shave. With no id (the live run just after recording) keep the original live behaviour.
  const { shaveId } = useParams<{ shaveId?: string }>();

  return (
    <main className="z-10 flex flex-col p-8 h-full gap-6 w-full min-w-0">
      <Heading>Workflow Progress</Heading>
      {shaveId ? (
        <ShaveOutcomeView shaveId={shaveId} />
      ) : (
        <>
          <WorkflowProgressPanel />
          <FinalResultPanel />
        </>
      )}
    </main>
  );
}
