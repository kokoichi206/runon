"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  defaultAvailability,
  type Activity,
  type DayAvailability,
  type Race,
  type WeeklyAvailability,
} from "@/shared/types/training";

const KEY = "flrt:training:v1";

export interface TrainingState {
  activities: Activity[];
  races: Race[];
  selectedRaceId: string | null;
  availability: WeeklyAvailability;
  /** 週あたりの練習回数（可能日の中から選ぶ）。 */
  runsPerWeek: number;
  skippedDates: string[];
  doneDates: string[];
}

const initialState = (): TrainingState => ({
  activities: [],
  races: [],
  selectedRaceId: null,
  availability: defaultAvailability(),
  runsPerWeek: 3,
  skippedDates: [],
  doneDates: [],
});

export interface TrainingStore extends TrainingState {
  loaded: boolean;
  setActivities: (activities: Activity[]) => void;
  addRace: (race: Race) => void;
  removeRace: (id: string) => void;
  selectRace: (id: string | null) => void;
  setAvailabilityDay: (weekday: number, patch: Partial<DayAvailability>) => void;
  setRunsPerWeek: (n: number) => void;
  toggleSkip: (date: string) => void;
  toggleDone: (date: string) => void;
  skipWeek: (dates: string[]) => void;
}

export function useTrainingStore(): TrainingStore {
  const [state, setState] = useState<TrainingState>(initialState);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TrainingState>;
        setState({ ...initialState(), ...parsed });
      }
    } catch {
      // localStorage 不可。メモリ上の既定値で継続。
    } finally {
      loadedRef.current = true;
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // 保存不可（プライベートモード等）。UI 上は動作継続。
    }
  }, [state]);

  const setActivities = useCallback((activities: Activity[]) => {
    setState((s) => ({ ...s, activities }));
  }, []);

  const addRace = useCallback((race: Race) => {
    setState((s) => ({
      ...s,
      races: [...s.races, race].sort((a, b) => a.date.localeCompare(b.date)),
      selectedRaceId: s.selectedRaceId ?? race.id,
    }));
  }, []);

  const removeRace = useCallback((id: string) => {
    setState((s) => {
      const races = s.races.filter((r) => r.id !== id);
      return {
        ...s,
        races,
        selectedRaceId:
          s.selectedRaceId === id ? (races[0]?.id ?? null) : s.selectedRaceId,
      };
    });
  }, []);

  const selectRace = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedRaceId: id }));
  }, []);

  const setAvailabilityDay = useCallback(
    (wd: number, patch: Partial<DayAvailability>) => {
      setState((s) => {
        const availability = s.availability.map((d, i) =>
          i === wd ? { ...d, ...patch } : d,
        );
        return { ...s, availability };
      });
    },
    [],
  );

  const setRunsPerWeek = useCallback((n: number) => {
    setState((s) => ({ ...s, runsPerWeek: Math.max(1, Math.min(7, Math.round(n))) }));
  }, []);

  const toggleSkip = useCallback((date: string) => {
    setState((s) => {
      const has = s.skippedDates.includes(date);
      return {
        ...s,
        skippedDates: has
          ? s.skippedDates.filter((d) => d !== date)
          : [...s.skippedDates, date],
      };
    });
  }, []);

  const toggleDone = useCallback((date: string) => {
    setState((s) => {
      const has = s.doneDates.includes(date);
      return {
        ...s,
        doneDates: has
          ? s.doneDates.filter((d) => d !== date)
          : [...s.doneDates, date],
      };
    });
  }, []);

  const skipWeek = useCallback((dates: string[]) => {
    setState((s) => {
      const set = new Set([...s.skippedDates, ...dates]);
      return { ...s, skippedDates: [...set] };
    });
  }, []);

  return {
    ...state,
    loaded,
    setActivities,
    addRace,
    removeRace,
    selectRace,
    setAvailabilityDay,
    setRunsPerWeek,
    toggleSkip,
    toggleDone,
    skipWeek,
  };
}
