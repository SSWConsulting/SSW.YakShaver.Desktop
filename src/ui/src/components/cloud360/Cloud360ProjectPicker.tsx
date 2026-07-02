import type { Cloud360Project } from "@shared/types/cloud360";
import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";

interface Props {
  value: string | null;
  onChange: (projectId: string | null) => void;
}

export function Cloud360ProjectPicker({ value, onChange }: Props) {
  const [projects, setProjects] = useState<Cloud360Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipcClient.cloud360
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((err) => {
        if (!cancelled) setError(formatErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-red-400/90">{error}</p>;
  }
  if (projects === null) {
    return <p className="text-sm text-white/60">Loading projects…</p>;
  }
  if (projects.length === 0) {
    return (
      <p className="text-sm text-white/60">
        No GitHub project found. Cloud 360 needs a GitHub-backed project.
      </p>
    );
  }

  return (
    <select
      className="rounded border border-white/10 bg-black/30 p-2 text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Select a project…</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
