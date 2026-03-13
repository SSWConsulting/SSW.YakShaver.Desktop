import { forwardRef, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

// Matches <REPLACE WITH something> placeholders, case-insensitive
const PLACEHOLDER_PATTERN = /<replace\s+with\s+[^>]+>/gi;

/** Returns true if the text contains any <REPLACE WITH ...> placeholder. */
export function hasPlaceholder(text: string): boolean {
  return /<replace\s+with\s+[^>]+>/i.test(text);
}

function renderHighlighted(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark
        key={`${match.index}-${match[0]}`}
        className="bg-amber-400/50 text-transparent rounded-sm"
      >
        {match[0]}
      </mark>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// Shared text styles — must be identical on both backdrop and textarea for pixel-perfect overlay
const SHARED_TEXT_CLASSES =
  "font-mono text-sm leading-relaxed p-3 whitespace-pre-wrap [word-break:break-word] break-words";

interface HighlightedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  containerClassName?: string;
}

export const HighlightedTextarea = forwardRef<HTMLTextAreaElement, HighlightedTextareaProps>(
  function HighlightedTextarea(
    { value = "", onChange, className, containerClassName, disabled, onScroll, ...props },
    ref,
  ) {
    const backdropRef = useRef<HTMLDivElement>(null);

    const handleScroll = useCallback(
      (e: React.UIEvent<HTMLTextAreaElement>) => {
        if (backdropRef.current) {
          // Sync backdrop scroll so highlights stay aligned with visible text
          backdropRef.current.scrollTop = e.currentTarget.scrollTop;
        }
        onScroll?.(e);
      },
      [onScroll],
    );

    const textValue = typeof value === "string" ? value : String(value ?? "");

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-md border border-white/20 bg-transparent dark:bg-input/30",
          containerClassName,
        )}
      >
        {/* Backdrop: renders highlighted placeholders behind the transparent textarea */}
        <div
          ref={backdropRef}
          aria-hidden="true"
          className={cn(
            SHARED_TEXT_CLASSES,
            "absolute inset-0 pointer-events-none text-transparent overflow-hidden",
          )}
        >
          {renderHighlighted(textValue)}
          {/* Extra newline prevents last-line highlight from being clipped */}
          {"\n"}
        </div>

        {/* Actual editable textarea — transparent background lets backdrop highlights show through */}
        <textarea
          ref={ref}
          value={value}
          onChange={onChange}
          onScroll={handleScroll}
          disabled={disabled}
          className={cn(
            SHARED_TEXT_CLASSES,
            // Hide the native scrollbar so backdrop and textarea always have the same effective
            // text width — without this the scrollbar narrows the textarea and misaligns highlights
            "absolute inset-0 w-full h-full bg-transparent text-white/90 caret-white resize-none outline-none overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          spellCheck={false}
          {...props}
        />
      </div>
    );
  },
);
