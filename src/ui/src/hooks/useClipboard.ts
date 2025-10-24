import { toast } from "sonner";

export const useClipboard = () => {
  const copyToClipboard = async (text: string | null) => {
    try {
      await navigator.clipboard.writeText(text || "");
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return { copyToClipboard };
};
