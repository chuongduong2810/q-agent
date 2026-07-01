import { toast } from "sonner";
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
          useUI.getState().openProject(project.name);
          useUI.getState().setProjectTab("knowledge");
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
