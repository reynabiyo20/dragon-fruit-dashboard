import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ManufactureRun, ManufactureInput } from '../types';
import { generateId, now } from '../utils/id';
import { todayISO } from '../utils/date';
import { seededPersist } from './persistHelpers';

const SEED_VERSION = 1;
const SEED_RUNS: ManufactureRun[] = [];

/** Tolerant (case + whitespace) key for a (category, subcategory) target. */
function targetKey(category: string, subcategory: string): string {
  return `${category.trim().toLowerCase()}||${subcategory.trim().toLowerCase()}`;
}

interface StageInputArgs {
  targetCategory: string;
  targetSubcategory: string;
  targetUnit: string; // finished-product unit (used when the run is produced)
  input: ManufactureInput;
  date?: string;
}

interface ManufacturingState {
  runs: ManufactureRun[];
  _seeded: number;

  /** The open (staged, not-yet-produced) run for a target, if any. */
  openRunFor: (category: string, subcategory: string) => ManufactureRun | undefined;
  /** All runs (staged + produced) for a target, most recent first. */
  runsFor: (category: string, subcategory: string) => ManufactureRun[];

  /**
   * Stage a raw-material input toward a target product. Appends to the target's
   * open run, creating one if none exists. Returns the run.
   * (The caller decrements the input inventory row's stock via `used`.)
   */
  stageInput: (data: StageInputArgs) => ManufactureRun;

  /**
   * Produce finished goods from a staged run: mark it produced with `producedQty`
   * finished units. Returns the produced run, or undefined if not found / not
   * staged. (The caller credits the target inventory row's `produced` pool.)
   */
  produceRun: (
    runId: string,
    producedQty: number,
    producedUnit: string,
    date?: string,
  ) => ManufactureRun | undefined;

  /** Remove a staged input from an open run (undo a mis-stage). */
  removeInput: (runId: string, index: number) => void;

  /** Delete a run entirely (e.g. abandon a staged run). */
  deleteRun: (runId: string) => void;
}

export const useManufacturingStore = create<ManufacturingState>()(
  persist(
    (set, get) => ({
      runs: SEED_RUNS,
      _seeded: SEED_VERSION,

      openRunFor: (category, subcategory) => {
        const key = targetKey(category, subcategory);
        return get().runs.find(
          (r) => r.status === 'staged' && targetKey(r.targetCategory, r.targetSubcategory) === key,
        );
      },

      runsFor: (category, subcategory) => {
        const key = targetKey(category, subcategory);
        return get()
          .runs.filter((r) => targetKey(r.targetCategory, r.targetSubcategory) === key)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      },

      stageInput: ({ targetCategory, targetSubcategory, targetUnit, input, date }) => {
        const existing = get().openRunFor(targetCategory, targetSubcategory);
        if (existing) {
          const updated: ManufactureRun = {
            ...existing,
            inputs: [...existing.inputs, input],
            producedUnit: existing.producedUnit || targetUnit,
            updatedAt: now(),
          };
          set((state) => ({ runs: state.runs.map((r) => (r.id === existing.id ? updated : r)) }));
          return updated;
        }
        const run: ManufactureRun = {
          id: generateId(),
          targetCategory,
          targetSubcategory,
          inputs: [input],
          producedQty: 0,
          producedUnit: targetUnit,
          status: 'staged',
          stagedDate: date || todayISO(),
          producedDate: '',
          notes: '',
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ runs: [...state.runs, run] }));
        return run;
      },

      produceRun: (runId, producedQty, producedUnit, date) => {
        const run = get().runs.find((r) => r.id === runId);
        if (!run || run.status !== 'staged') return undefined;
        const produced: ManufactureRun = {
          ...run,
          status: 'produced',
          producedQty,
          producedUnit: producedUnit || run.producedUnit,
          producedDate: date || todayISO(),
          updatedAt: now(),
        };
        set((state) => ({ runs: state.runs.map((r) => (r.id === runId ? produced : r)) }));
        return produced;
      },

      removeInput: (runId, index) =>
        set((state) => ({
          runs: state.runs.map((r) =>
            r.id === runId ? { ...r, inputs: r.inputs.filter((_, i) => i !== index), updatedAt: now() } : r,
          ),
        })),

      deleteRun: (runId) =>
        set((state) => ({ runs: state.runs.filter((r) => r.id !== runId) })),
    }),
    seededPersist<ManufacturingState>('dfd-manufacturing', 'runs', SEED_RUNS, SEED_VERSION),
  ),
);
