import type React from "react";
import { cn } from "@/lib/utils";

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  content: string;
}

export function CodeBlock({ content, className, ...props }: CodeBlockProps) {
  return (
    <pre className={cn("text-sm whitespace-pre-wrap font-sans break-all", className)} {...props}>
      {content}
    </pre>
  );
}
