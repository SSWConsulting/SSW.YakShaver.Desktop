import * as React from "react";
import { cn } from "@/lib/utils";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type HeadingTagProps = {
  children: React.ReactNode;
  level: HeadingLevel;
  className?: string;
};
export default function HeadingTag({
  children,
  level,
  className,
}: HeadingTagProps) {
  const HEADING_WEIGHT = "font-[600]";

  const HeadingTag = `h${level}` as keyof Pick<JSX.IntrinsicElements, "h1" | "h2" | "h3" | "h4" | "h5" | "h6">;
  const typography: Record<HeadingLevel, string> = {
    1: "text-4xl leading-[1.2]", 
    2: "text-3xl leading-[1.2]", 
    3: "text-2xl leading-[1.2] ",
    4: "text-xl leading-[1.3] ", 
    5: "text-lg leading-[1.4]", 
    6: "text-base leading-[1.4]", 
  };


  const id = children?.toString()?.toLowerCase()?.replace(/ /g, '-')

  return (
    <HeadingTag id={id}
      className={cn(HEADING_WEIGHT, `${typography[level]}`, className)}
    >
      {children}
    </HeadingTag>
  );
}
