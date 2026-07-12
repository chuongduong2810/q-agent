import type { ProviderKind } from "@/types/api";

export interface ProjectMeta {
  name: string;
  repo: string;
  framework: string;
  provider: string;
  providerKind: ProviderKind;
  tickets: number;
  runs: number;
  rate: string;
}
