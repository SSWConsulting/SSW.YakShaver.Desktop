import type { Project } from "@shared/types/portal";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Heading } from "@/components/typography/heading-tag";
import { LoadingState } from "../components/common/LoadingState";
import { NoProjects } from "../components/projects/NoProjects";
import { Button } from "../components/ui/button";
import { ipcClient } from "../services/ipc-client";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSignedOut(false);
    try {
      const result = await ipcClient.portal.getMyProjects();
      if (!result.success) {
        if (result.code === "NOT_SIGNED_IN") {
          setSignedOut(true);
        } else {
          setError(result.error || "Failed to load projects");
        }
        return;
      }
      setProjects(result.data?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <main className="z-10 flex flex-col p-8 h-full gap-6 w-full min-w-0">
      <div className="flex items-center justify-between">
        <Heading>Projects</Heading>
        <Button variant="outline" size="sm" onClick={loadProjects} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingState />
      ) : signedOut ? (
        <div className="rounded-md border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-muted-foreground">Sign in to see your projects.</p>
        </div>
      ) : error ? (
        <div className="rounded-md border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-muted-foreground">Couldn't load your projects.</p>
          <p className="mt-1 text-sm text-muted-foreground/70">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={loadProjects}>
            Try again
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <NoProjects />
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li
              key={project.id}
              className="rounded-md border border-white/10 bg-white/5 px-5 py-4 transition-colors hover:bg-white/8"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">{project.name}</span>
                {project.description ? (
                  <span className="text-sm text-muted-foreground">{project.description}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
