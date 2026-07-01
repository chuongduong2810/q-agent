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
  ProviderFieldsIn,
  ProviderKind,
  RunCreate,
  SettingsUpdate,
  SyncRequest,
  TestCaseCreate,
  TestCaseUpdate,
} from "@/types/api";

// -------------------------------------------------------------- health
export const useCapabilities = () =>
  useQuery({ queryKey: queryKeys.capabilities, queryFn: api.capabilities });

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

// -------------------------------------------------------------- tickets
export const useTickets = (filters: { status?: string; assignee?: string; sprint?: string; q?: string } = {}) =>
  useQuery({ queryKey: queryKeys.tickets(filters), queryFn: () => api.listTickets(filters) });

export const useTicket = (externalId: string | null) =>
  useQuery({
    queryKey: queryKeys.ticket(externalId ?? ""),
    queryFn: () => api.getTicket(externalId as string),
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

// -------------------------------------------------------------- automation
export const useSpecs = (runId: number | string | null) =>
  useQuery<AutomationSpecOut[]>({
    queryKey: queryKeys.specs(runId ?? 0),
    queryFn: () => api.listSpecs(runId as number),
    enabled: runId != null,
  });

export const useGenerateAutomation = (runId: number | string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateAutomation(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.specs(runId) });
      qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
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

// -------------------------------------------------------------- execution
export const useExecution = (runId: number | string | null) =>
  useQuery({
    queryKey: queryKeys.execution(runId ?? 0),
    queryFn: () => api.getExecution(runId as number),
    enabled: runId != null,
    retry: false,
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
