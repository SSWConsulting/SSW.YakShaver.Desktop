import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function NoProjects() {
  return (
    <Empty>
      <EmptyHeader className="gap-4 items-start!">
        <EmptyTitle>📁 - No projects to show yet</EmptyTitle>
        <EmptyDescription>
          Projects will appear here once they're available. Check back later.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
