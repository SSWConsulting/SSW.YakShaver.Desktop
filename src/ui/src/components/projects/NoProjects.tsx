import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function NoProjects() {
  return (
    <Empty>
      <EmptyHeader className="gap-4 items-start!">
        <EmptyTitle>📁 - You're not a member of any projects yet</EmptyTitle>
        <EmptyDescription>
          Projects you're added to will appear here. Ask a project owner to add you, or check back
          later.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
