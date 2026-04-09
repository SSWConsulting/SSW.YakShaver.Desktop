import HeadingTag from "@/components/typography/heading-tag";
import { FinalResultPanel } from "../components/workflow/FinalResultPanel";
import { WorkflowProgressPanel } from "../components/workflow/WorkflowProgressPanel";

export function WorkflowPage() {
  return (
    <main className="z-10 flex flex-col p-8 h-full gap-6 w-full min-w-0">
      <HeadingTag level={1}>Workflow Progress</HeadingTag>
      <WorkflowProgressPanel />
      <FinalResultPanel />
    </main>
  );
}
