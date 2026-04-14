import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

const NO_SHAVES_STEPS: string[] = [
  "Record screen and describe the issue",
  "AI transcribes and analyzes content",
  "Receive a structured work item ready to send",
];

export function NoShaves() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>You don't have any YakShaves yet!</EmptyTitle>
        <EmptyDescription>Get started in 3 easy steps:</EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-col gap-6">
        {NO_SHAVES_STEPS.map((step, index) => (
          <div key={step} className="flex items-center gap-3">
            <span className="rounded-full border border-white/25 h-8 w-8 flex items-center justify-center text-sm font-medium">
              {index + 1}
            </span>
            <span className="font-light text-muted-foreground">{step}</span>
          </div>
        ))}
      </div>
    </Empty>
  );
}
