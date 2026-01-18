import { cn } from "@/lib/utils";
import type { WorkflowStep } from "@shared/types/workflow";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { StageWithContent } from "./StageWithContent";

const STATUS_CONFIG = {
  in_progress: {
    icon: Loader2,
    iconClass: "animate-spin text-zinc-300",
    containerClass: "border-gray-500/30 bg-gray-500/5",
    textClass: "text-white/90",
  },
  completed: {
    icon: CheckCircle2,
    iconClass: "text-green-400",
    containerClass: "border-green-500/30 bg-green-500/5",
    textClass: "text-white/90",
  },
  failed: {
    icon: XCircle,
    iconClass: "text-red-400",
    containerClass: "border-red-500/30 bg-red-500/5",
    textClass: "text-white/90",
  },
  not_started: {
    icon: null,
    iconClass: "",
    containerClass: "border-white/10 bg-black/20",
    textClass: "text-white/30",
  },
} as const;

function StatusIcon({ 
  status, 
  className 
}: { 
  status: WorkflowStep["status"]; 
  className?: string; 
}) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.not_started;
  const Icon = config.icon;

  if (!Icon) {
    return <div className={cn("size-5 rounded-full border-2 border-white/20", className)} />;
  }

  return <Icon className={cn("size-5", config.iconClass, className)} />;
}

export function WorkflowStepCard({ step, label }: { step: WorkflowStep; label: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { hasPayload, parsedPayload } = useMemo(() => {
    if (!step.payload) return { hasPayload: false, parsedPayload: null };

    try {
      const parsed = JSON.parse(step.payload);
      const isValid = parsed !== null && 
        (typeof parsed === 'object' ? Object.keys(parsed).length > 0 : true);
      return { hasPayload: isValid, parsedPayload: parsed };
    } catch {
      return { hasPayload: !!step.payload, parsedPayload: step.payload };
    }
  }, [step.payload]);

  if (step.status === "skipped") return null;

  const config = STATUS_CONFIG[step.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.not_started;

  const toggleExpand = () => {
    if (hasPayload) setIsExpanded(!isExpanded);
  };

  const HeaderContent = () => (
    <div className="flex items-center gap-3">
      <StatusIcon status={step.status} />
      <span className={cn("font-medium", config.textClass)}>{label}</span>
    </div>
  );

  return (
    <Card 
      className={cn(
        "rounded-lg p-3 gap-0 transition-all", 
        config.containerClass
      )}
    >
      {hasPayload ? (
        <Button
          variant="ghost"
          onClick={toggleExpand}
          className="h-auto w-full justify-between p-0 text-base hover:bg-transparent hover:text-current dark:hover:bg-transparent"
          aria-expanded={isExpanded}
        >
          <HeaderContent />
          <div className="text-white/50 hover:text-white/90">
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </div>
        </Button>
      ) : (
        <div className="flex w-full items-center justify-between">
          <HeaderContent />
        </div>
      )}

      {isExpanded && hasPayload && (
        <CardContent className="p-0 pt-2">
          <div className="overflow-x-auto rounded bg-black/20 p-2 text-white/80">
             <StageWithContent stage={step.stage} payload={parsedPayload} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
