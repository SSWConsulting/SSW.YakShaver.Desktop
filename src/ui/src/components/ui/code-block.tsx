import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type React from "react";

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  content: string;
}

export function CodeBlock({ content, className, ...props }: CodeBlockProps) {
  return (
    <ScrollArea className={cn("rounded-md border", className)}>
      <div className="p-4">
        <pre className="text-sm whitespace-pre-wrap font-sans break-all" {...props}>
          {content}
        </pre>
      </div>
    </ScrollArea>
  );
}
