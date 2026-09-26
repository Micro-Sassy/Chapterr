import { useQuery } from "@tanstack/react-query";
import type { PublicConfig } from "@shared/types";
import { api } from "./api";

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => api<PublicConfig>("/api/config"),
    staleTime: 60 * 60 * 1000,
  });
}
