import { useNavigate } from "react-router-dom";
import { toast } from "@/lib/toast";
import { useBuildKnowledge } from "@/hooks/queries";
import { useUI } from "@/store/ui";

export interface BuildTarget {
  name: string;
  provider: string;
  repo: string;
  framework: string;
}

/**
 * Kicks off a real Project Knowledge build (Claude project-bootstrap) while the
 * cosmetic build overlay animates. On success, lands on the project's Knowledge
 * tab; on failure, closes the overlay and surfaces the error.
 */
export function useKnowledgeBuilder() {
  const build = useBuildKnowledge();
  const navigate = useNavigate();
  return (project: BuildTarget) => {
    const ui = useUI.getState();
    ui.startKnowledgeBuild(project.name);
    build.mutate(
      {
        key: project.name,
        body: {
          name: project.name,
          provider: project.provider,
          repo: project.repo,
          framework: project.framework,
        },
      },
      {
        onSuccess: () => {
          useUI.getState().endKnowledgeBuild();
          navigate(`/projects/${encodeURIComponent(project.name)}?tab=knowledge`);
          toast.success(`Project Knowledge built for ${project.name}`);
        },
        onError: (err) => {
          useUI.getState().endKnowledgeBuild();
          toast.error(err instanceof Error ? err.message : "Knowledge build failed");
        },
      },
    );
  };
}
