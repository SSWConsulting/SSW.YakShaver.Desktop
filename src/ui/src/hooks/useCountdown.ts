import { useEffect, useState } from "react";

interface UseCountdownOptions {
  initialSeconds?: number;
  onComplete?: () => void;
}

interface UseCountdownReturn {
  countdown: number;
  isActive: boolean;
  start: (seconds?: number) => void;
  reset: () => void;
}

export const useCountdown = (options: UseCountdownOptions = {}): UseCountdownReturn => {
  const { initialSeconds = 60, onComplete } = options;
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((prev) => {
          const next = prev - 1;
          if (next === 0 && onComplete) {
            onComplete();
          }
          return next;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown, onComplete]);

  const start = (seconds?: number) => {
    setCountdown(seconds ?? initialSeconds);
  };

  const reset = () => {
    setCountdown(0);
  };

  return {
    countdown,
    isActive: countdown > 0,
    start,
    reset,
  };
};
