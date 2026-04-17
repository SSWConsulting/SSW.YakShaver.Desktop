import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const NO_SHAVES_STEPS: string[] = [
  "Record screen and describe the issue",
  "See AI transcribe and analyze your video",
  "Open the generated work item",
];

export function NoShaves() {
  return (
    <Empty>
      <EmptyHeader className='gap-6 items-start!'>
        <EmptyTitle>⛔️ - You don't have any YakShaves yet!</EmptyTitle>
        <EmptyDescription className="">Get started in 3 easy steps:</EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-col gap-6">
        {NO_SHAVES_STEPS.map((step, index) => (
          <div key={step} className="flex items-center gap-3">
            <span className="rounded-full border border-white/25 h-8 w-8 flex items-center justify-center text-lg font-medium">
              {index + 1}
            </span>
            <span className="font-light text-muted-foreground">{step}</span>
          </div>
        ))}
      </div>
    </Empty>
  );
}
