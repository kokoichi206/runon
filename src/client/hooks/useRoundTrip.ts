"use client";

import { useCallback, useState } from "react";

import type { RoundTripRequest, RoundTripResult } from "@/shared/types/round-trip";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: RoundTripResult }
  | { status: "error"; message: string };

export interface UseRoundTrip {
  state: State;
  run: (req: RoundTripRequest) => Promise<void>;
}

export function useRoundTrip(): UseRoundTrip {
  const [state, setState] = useState<State>({ status: "idle" });

  const run = useCallback(async (req: RoundTripRequest) => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/round-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const json = await res.json();
      if (!res.ok) {
        setState({
          status: "error",
          message: json?.error ?? `エラー (HTTP ${res.status})`,
        });
        return;
      }
      setState({ status: "success", result: json as RoundTripResult });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "通信に失敗しました。",
      });
    }
  }, []);

  return { state, run };
}
