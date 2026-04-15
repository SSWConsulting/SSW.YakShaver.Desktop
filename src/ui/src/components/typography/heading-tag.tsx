import * as React from "react";
import { cn } from "@/lib/utils";

type HeadingElement = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type HeadingProps = {
  as?: HeadingElement;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLHeadingElement>;

const styles: Record<HeadingElement, string> = {
  h1: "text-4xl leading-tight",
  h2: "text-3xl leading-tight",
  h3: "text-2xl leading-tight",
  h4: "text-xl leading-snug",
  h5: "text-lg leading-snug",
  h6: "text-base leading-snug",
};

export function Heading({
  as = "h1",
  className,
  children,
  ...props
}: HeadingProps) {
  const Tag = as;

  return (
    <Tag
      className={cn("font-semibold", styles[as], className)}
      {...props}
    >
      {children}
    </Tag>
  );
}
