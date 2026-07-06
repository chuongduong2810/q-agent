/**
 * TanStack Query hooks for every Q-Agent resource. Screens import these instead
 * of calling `api.*` directly, so cache keys + invalidation stay consistent.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AnnotationShape,
  AutomationSpecOut,
  KnowledgeBuildRequest,
  ProjectConfigUpdate,
  ProviderFieldsIn,
  ProviderKind,
  RunCreate,
  SettingsUpdate,
  SyncRequest,
  TestCaseCreate,
  TestCaseUpdate,
  TicketFilters,
} from "@/types/api";

// -------------------------------------------------------------- health
export const useCapabilities = () =>
  useQuery({ queryKey: queryKeys.capabilities, queryFn: api.capabilities });

// Claude usage stats for the top-bar chip + panel; refetched on a light poll.
export const useAiStats = () =>
  useQuery({ queryKey: queryKeys.aiStats, queryFn: api.aiStats, refetchInterval: 30_000 });

// -------------------------------------------------------------- providers + settings
export const useProviders = () =>
  useQuery({ queryKey: queryKeys.providers, queryFn: api.listProviders });

export const useSaveProvider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, body }: { kind: ProviderKind; body: ProviderFieldsIn }) =>
      api.saveProvider(kind, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.providers }),
  });
};

export const useTestConnection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: ProviderKind) => api.testConnection(kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.providers }),
  });
};

export const useSprints = (kind: ProviderKind | null) =>
  useQuery({
    queryKey: queryKeys.sprints(kind ?? ""),
    queryFn: () => api.listSprints(kind as ProviderKind),
    enabled: !!kind,
    staleTime: 60_000,
  });

export const useWorkItemMetadata = (kind: ProviderKind | null) =>
  useQuery({
    queryKey: queryKeys.workItemMetadata(kind ?? ""),
    queryFn: () => api.workItemMetadata(kind as ProviderKind),
    enabled: !!kind,
    staleTime: 60_000,
  });

export const useSettings = () =>
  useQuery({ queryKey: queryKeys.settings, queryFn: api.getSettings });

export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsUpdate) => api.updateSettings(body),
    onSuccess: (data) => qc.setQueryData(queryKeys.settings, data),
  });
};

// -------------------------------------------------------------- projects
export const useProjects = () =>
  useQuery({ queryKey: queryKeys.projects, queryFn: api.listProjects });

export const useRefreshProjects = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.refreshProjects,
    onSuccess: (data) => qc.setQueryData(queryKeys.projects, data),
  });
};

export const useKnowledgeList = () =>
  useQuery({ queryKey: queryKeys.knowledgeList, queryFn: api.listKnowledge });

export const useProjectKnowledge = (key: string | null) =>
  useQuery({
    queryKey: queryKeys.projectKnowledge(key ?? ""),
    queryFn: () => api.getProjectKnowledge(key as string),
    enabled: !!key,
    retry: false,
  });

export const useBuildKnowledge = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: KnowledgeBuildRequest }) =>
      api.buildKnowledge(key, body),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.projectKnowledge(data.key), data);
      qc.invalidateQueries({ queryKey: queryKeys.knowledgeList });
    },
  });
};

export const useProjectConfig = (key: string | null) =>
  useQuery({
    queryKey: queryKeys.projectConfig(key ?? ""),
    queryFn: () => api.getProjectConfig(key as string),
    enabled: !!key,
    retry: false,
  });

export const useSaveProjectConfig = (key: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectConfigUpdate) => api.saveProjectConfig(key, body),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.projectConfig(key), data);
      qc.invalidateQueries({ queryKey: queryKeys.projectRepos(key) });
    },
  });
};

export const useProjectAuth = (key: string | null) =>
  useQuery({
    queryKey: queryKeys.projectAuth(key ?? ""),
    queryFn: () => api.getProjectAuth(key as string),
    enabled: !!key,
    retry: false,
    // While a capture is running on the host, poll so the UI flips to
    // "captured" automatically once the operator finishes logging in.
    refetchInterval: (q) => (q.state.data?.capturing ? 1500 : false),
  });

export const useClearProjectAuth = (key: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearProjectAuth(key),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.projectAuth(key), data);
      qc.invalidateQueries({ queryKey: queryKeys.projectAuth(key) });
    },
  });
};

export const useCaptureProjectAuth = (key: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.captureProjectAuth(key),
    onSuccess: (data) => {
      // Seed the cache with `capturing: true` so useProjectAuth starts polling.
      qc.setQueryData(queryKeys.projectAuth(key), data);
      qc.invalidateQueries({ queryKey: queryKeys.projectAuth(key) });
    },
  });
};

export const useProjectRepos = (key: string | null) =>
  useQuery({
    queryKey: queryKeys.projectRepos(key ?? ""),
    queryFn: () => api.listProjectRepos(key as string),
    enabled: !!key,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "indexing") ? 2000 : false),
  });

export const useAvailableRepos = (key: string | null, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.availableRepos(key ?? ""),
    queryFn: () => api.availableRepos(key as string),
    enabled: !!key && enabled,
    staleTime: 60_000,
  });

export const useRepoKnowledge = (key: string | null, repo: string | null) =>
  useQuery({
    queryKey: queryKeys.repoKnowledge(key ?? "", repo ?? ""),
    queryFn: () => api.getRepoKnowledge(key as string, repo as string),
    enabled: !!key && !!repo,
    retry: false,
  });

export const useBuildRepoKnowledge = (key: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repo, body }: { repo: string; body: KnowledgeBuildRequest }) =>
      api.buildRepoKnowledge(key, repo, body),
    onSuccess: (data, vars) => {
      qc.setQueryData(queryKeys.repoKnowledge(key, vars.repo), data);
      qc.invalidateQueries({ queryKey: queryKeys.projectRepos(key) });
    },
  });
};

// -------------------------------------------------------------- tickets
export const useTickets = (filters: TicketFilters = {}) =>
  useQuery({
    queryKey: queryKeys.tickets(filters as Record<string, string | undefined>),
    queryFn: () => api.listTickets(filters),
  });

export const useTicket = (externalId: string | null) =>
  useQuery({
    queryKey: queryKeys.ticket(externalId ?? ""),
    queryFn: () => api.getTicket(externalId as string),
    enabled: !!externalId,
  });

export const useLinkedCases = (externalId: string | null) =>
  useQuery({
    queryKey: queryKeys.linkedCases(externalId ?? ""),
    queryFn: () => api.linkedCases(externalId as string),
    enabled: !!externalId,
  });

export const useSyncTickets = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncRequest) => api.syncTickets(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
};

// -------------------------------------------------------------- runs
export const useRuns = () => useQuery({ queryKey: queryKeys.runs, queryFn: api.listRuns });

export const useRun = (runId: number | string | null, opts?: Partial<UseQueryOptions>) =>
  useQuery({
    queryKey: queryKeys.run(runId ?? 0),
    queryFn: () => api.getRun(runId as number),
    enabled: runId != null,
    ...(opts as object),
  });

export const useCreateRun = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunCreate) => api.createRun(body),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: queryKeys.runs });
      qc.setQueryData(queryKeys.run(run.id), run);
    },
  });
};

export const useRegenerateRun = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.regenerateRun(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.run(runId) }),
  });
};

export const useRunRepos = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.runRepos(runId ?? 0),
    queryFn: () => api.runRepos(runId as number),
    enabled: runId != null,
  });

export const useSetRunTicketRepo = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tid, repo }: { tid: string; repo: string }) =>
      api.setRunTicketRepo(runId, tid, repo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
      qc.invalidateQueries({ queryKey: queryKeys.runRepos(runId) });
    },
  });
};

// -------------------------------------------------------------- review / cases
export const useRunCases = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.runCases(runId ?? 0),
    queryFn: () => api.listCases(runId as number),
    enabled: runId != null,
  });

export const useCaseMutations = (runId: number | string) => {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.runCases(runId) });
    qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
  };
  return {
    addCase: useMutation({
      mutationFn: (body: TestCaseCreate) => api.addCase(runId, body),
      onSuccess: invalidate,
    }),
    updateCase: useMutation({
      mutationFn: ({ caseId, body }: { caseId: number; body: TestCaseUpdate }) =>
        api.updateCase(caseId, body),
      onSuccess: invalidate,
    }),
    setApproval: useMutation({
      mutationFn: ({ caseId, approval }: { caseId: number; approval: "approved" | "rejected" | "pending" }) =>
        api.setApproval(caseId, approval),
      onSuccess: invalidate,
    }),
    regenerateCase: useMutation({
      mutationFn: (caseId: number) => api.regenerateCase(caseId),
      onSuccess: invalidate,
    }),
    approveAll: useMutation({ mutationFn: () => api.approveAll(runId), onSuccess: invalidate }),
    approveTicket: useMutation({
      mutationFn: (tid: string) => api.approveTicket(runId, tid),
      onSuccess: invalidate,
    }),
  };
};

// -------------------------------------------------------------- create & link
export const useLinkStatus = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.linkStatus(runId ?? 0),
    queryFn: () => api.linkStatus(runId as number),
    enabled: runId != null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1200 : false),
  });

export const useCreateAndLink = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { link?: boolean; ticketIds?: string[]; dryRun?: boolean }) =>
      api.createAndLink(runId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.linkStatus(runId) });
      qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
    },
  });
};

// -------------------------------------------------------------- automation
export const useSpecs = (runId: number | string | null) =>
  useQuery<AutomationSpecOut[]>({
    queryKey: queryKeys.specs(runId ?? 0),
    queryFn: () => api.listSpecs(runId as number),
    enabled: runId != null,
  });

export const useAutomationStatus = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.automationStatus(runId ?? 0),
    queryFn: () => api.automationStatus(runId as number),
    enabled: runId != null,
    refetchInterval: (q) => (q.state.data?.generating ? 1500 : false),
  });

export const useGenerateAutomation = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force?: boolean) => api.generateAutomation(runId, force ?? false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.specs(runId) });
      qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
      qc.invalidateQueries({ queryKey: queryKeys.automationStatus(runId) });
    },
  });
};

export const useRegenerateSpec = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: number) => api.regenerateSpec(caseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.specs(runId) }),
  });
};

export const useUpdateSpec = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, code }: { caseId: number; code: string }) => api.updateSpec(caseId, code),
    onSuccess: (spec) => {
      qc.setQueryData<AutomationSpecOut[]>(queryKeys.specs(runId), (prev) =>
        prev ? prev.map((s) => (s.id === spec.id ? spec : s)) : prev,
      );
      qc.invalidateQueries({ queryKey: queryKeys.specs(runId) });
    },
  });
};

// Start a self-heal pass for a case. The POST only *kicks off* the background
// loop; the spec query is invalidated on the terminal WS event, not here.
export const useHealSpec = (_runId: number | string) =>
  useMutation({
    mutationFn: (caseId: number) => api.healSpec(caseId),
  });

// Poll heal status so the "Healing…" state survives navigating away and back.
export const useHealStatus = (caseId: number, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.healStatus(caseId),
    queryFn: () => api.healStatus(caseId),
    enabled: !!caseId && enabled,
    // Fetch once on select (catches a heal already running after navigation),
    // then poll only while a heal is actually in flight — the live button state
    // during an active session is driven by the WS stream + mutation isPending.
    refetchInterval: (q) => (q.state.data?.healing ? 1500 : false),
  });

// The last self-heal trail for a case (per-attempt error + diff + outcome).
export const useHealReport = (caseId: number, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.healReport(caseId),
    queryFn: () => api.healReport(caseId),
    enabled: !!caseId && enabled,
  });

// Run just one case's spec (the "run this test" action). Invalidates the run's
// execution so the per-spec status dots refresh.
export const useRunSpec = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: number) => api.runSpec(caseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.execution(runId) }),
  });
};

// -------------------------------------------------------------- execution
export const useExecution = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.execution(runId ?? 0),
    queryFn: () => api.getExecution(runId as number),
    enabled: runId != null,
    retry: false,
    // Poll while an execution is in flight so run state (incl. the per-spec
    // "Run" button) clears promptly even if a WS event is missed.
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1200 : false),
  });

export const useStartExecution = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { workers?: number; env?: string } = {}) => api.startExecution(runId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.execution(runId) });
      qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
    },
  });
};

// -------------------------------------------------------------- evidence
export const useEvidence = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.evidence(runId ?? 0),
    queryFn: () => api.getEvidence(runId as number),
    enabled: runId != null,
    retry: false,
  });

export const useAnnotate = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ evidenceId, shapes }: { evidenceId: number; shapes: AnnotationShape[] }) =>
      api.annotate(evidenceId, shapes),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.evidence(runId) }),
  });
};

// Auto-analyze a failure screenshot with Claude vision and burn annotations on it.
export const useAutoAnnotate = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (evidenceId: number) => api.autoAnnotateEvidence(evidenceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.evidence(runId) }),
  });
};

// -------------------------------------------------------------- reports
export const useReport = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.report(runId ?? 0),
    queryFn: () => api.getReport(runId as number),
    enabled: runId != null,
    retry: false,
  });

export const useReports = () =>
  useQuery({ queryKey: queryKeys.reports, queryFn: api.listReports });

// -------------------------------------------------------------- audit log
export const useAuditEvents = (filters: { category?: string; actor?: string; q?: string }) =>
  useQuery({
    queryKey: queryKeys.auditEvents(filters),
    queryFn: () => api.auditEvents(filters),
  });

export const useAuditStats = () =>
  useQuery({ queryKey: queryKeys.auditStats, queryFn: api.auditStats });

export const useClearAuditEvents = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.clearAuditEvents,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["audit", "events"] });
      qc.invalidateQueries({ queryKey: queryKeys.auditStats });
    },
  });
};

// `live` enables ~1.5s polling for the log tail.
export const useBackendLogs = (
  filters: { level?: string; service?: string; q?: string },
  live: boolean,
) =>
  useQuery({
    queryKey: queryKeys.backendLogs(filters),
    queryFn: () => api.backendLogs(filters),
    refetchInterval: live ? 1500 : false,
  });

export const useBackendLogStats = (live: boolean) =>
  useQuery({
    queryKey: queryKeys.backendLogStats,
    queryFn: api.backendLogStats,
    refetchInterval: live ? 1500 : false,
  });

export const useBuildReport = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.buildReport(runId),
    onSuccess: (r) => qc.setQueryData(queryKeys.report(runId), r),
  });
};

// -------------------------------------------------------------- comments / publish
export const useComments = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.comments(runId ?? 0),
    queryFn: () => api.listComments(runId as number),
    enabled: runId != null,
  });

export const useCommentMutations = (runId: number | string) => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.comments(runId) });
  return {
    prepare: useMutation({ mutationFn: () => api.prepareComments(runId), onSuccess: invalidate }),
    edit: useMutation({
      mutationFn: ({ commentId, body }: { commentId: number; body: { body?: string; targetStatus?: string } }) =>
        api.editComment(commentId, body),
      onSuccess: invalidate,
    }),
    publishOne: useMutation({ mutationFn: (commentId: number) => api.publishComment(commentId), onSuccess: invalidate }),
    publishAll: useMutation({ mutationFn: (ticketIds: string[]) => api.publishAll(runId, ticketIds), onSuccess: invalidate }),
    retry: useMutation({ mutationFn: () => api.retryComments(runId), onSuccess: invalidate }),
  };
};
