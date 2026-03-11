import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const useClipboard = (duration = 2000) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyToClipboard = useCallback(
    async (text: string | null, message = "Copied to clipboard") => {
      try {
        await navigator.clipboard.writeText(text ?? "");
        setCopied(true);
        toast.success(message);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), duration);
      } catch {
        toast.error("Failed to copy");
      }
    },
    [duration],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { copied, copyToClipboard };
};
