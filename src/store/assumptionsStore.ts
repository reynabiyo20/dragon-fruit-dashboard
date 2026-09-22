import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  FRUIT_WEIGHT_KG,
  YIELD_FRUITS_GRAFTED,
  YIELD_FRUITS_UNROOTED,
  YIELD_FRUITS_PER_MATURE_PLANT,
  HARVEST_DAYS_GRAFTED,
  HARVEST_DAYS_UNROOTED,
  CUTTING_CALLUSING_DAYS,
  CUTTING_ROOT_WEEKS_DEFAULT,
  CUTTING_READY_BASE_WEEKS_DEFAULT,
  CUTTING_UNROOTED_MODIFIER_WEEKS_DEFAULT,
} from '../constants';

/**
 * User-editable lifecycle assumptions for the cuttings → fruit growth cycle.
 *
 * These were hardcoded constants; they're now overridable in Settings so the
 * user can tune the model to their real orchard. The forecast engine and cutting
 * math read these (falling back to the seeded constant defaults). Changing a
 * value re-derives the wholesale forecast live (it's read reactively) — no data
 * is rewritten, since these are projection inputs, not stored records.
 */
export interface LifecycleAssumptions {
  /** Average weight of one dragon fruit (kg). */
  fruitWeightKg: number;
  /** First-harvest fruits per grafted cutting. */
  yieldFruitsGrafted: number;
  /** First-harvest fruits per unrooted cutting. */
  yieldFruitsUnrooted: number;
  /** Fruits per mature/established farm plant, per in-season harvest. */
  yieldFruitsPerMaturePlant: number;
  /** Days from deployment (planted/delivered) to first harvest — grafted. */
  harvestDaysGrafted: number;
  /** Days from deployment to first harvest — unrooted. */
  harvestDaysUnrooted: number;
  /** Callusing/heal hold (days) after harvesting internal cuttings. */
  callusingDays: number;
  /** Default weeks a grafted cutting needs to root before it's sellable. */
  rootWeeksDefault: number;
  /** Base grow-out weeks until a cutting is ready (before the cutting-type modifier). */
  cuttingReadyBaseWeeks: number;
  /** Extra weeks an unrooted cutting needs on top of the base (grafted adds none). */
  cuttingUnrootedModifierWeeks: number;
}

/** The seeded defaults, mirrored from the static constants. */
export const DEFAULT_ASSUMPTIONS: LifecycleAssumptions = {
  fruitWeightKg: FRUIT_WEIGHT_KG,
  yieldFruitsGrafted: YIELD_FRUITS_GRAFTED,
  yieldFruitsUnrooted: YIELD_FRUITS_UNROOTED,
  yieldFruitsPerMaturePlant: YIELD_FRUITS_PER_MATURE_PLANT,
  harvestDaysGrafted: HARVEST_DAYS_GRAFTED,
  harvestDaysUnrooted: HARVEST_DAYS_UNROOTED,
  callusingDays: CUTTING_CALLUSING_DAYS,
  rootWeeksDefault: CUTTING_ROOT_WEEKS_DEFAULT,
  cuttingReadyBaseWeeks: CUTTING_READY_BASE_WEEKS_DEFAULT,
  cuttingUnrootedModifierWeeks: CUTTING_UNROOTED_MODIFIER_WEEKS_DEFAULT,
};

/** Bump to push a new default set to existing users (reseeds on rehydrate). */
const SEED_VERSION = 2;

interface AssumptionsState {
  values: LifecycleAssumptions;
  _seeded: number;
  /** Update one or more assumptions (blank/NaN values are ignored). */
  set: (patch: Partial<LifecycleAssumptions>) => void;
  /** Reset every assumption back to the seeded defaults. */
  reset: () => void;
}

/** Coerce to a positive finite number, else fall back to the current value. */
function num(next: unknown, current: number): number {
  const n = Number(next);
  return Number.isFinite(n) && n > 0 ? n : current;
}

/**
 * Like `num` but allows zero — used for the unrooted modifier, where 0 is a
 * valid value (an unrooted cutting that needs no extra rooting time).
 */
function numAllowZero(next: unknown, current: number): number {
  const n = Number(next);
  return Number.isFinite(n) && n >= 0 ? n : current;
}

export const useAssumptionsStore = create<AssumptionsState>()(
  persist(
    (set) => ({
      values: { ...DEFAULT_ASSUMPTIONS },
      _seeded: SEED_VERSION,

      set: (patch) =>
        set((state) => {
          const v = state.values;
          return {
            values: {
              fruitWeightKg: num(patch.fruitWeightKg ?? v.fruitWeightKg, v.fruitWeightKg),
              yieldFruitsGrafted: num(patch.yieldFruitsGrafted ?? v.yieldFruitsGrafted, v.yieldFruitsGrafted),
              yieldFruitsUnrooted: num(patch.yieldFruitsUnrooted ?? v.yieldFruitsUnrooted, v.yieldFruitsUnrooted),
              yieldFruitsPerMaturePlant: num(patch.yieldFruitsPerMaturePlant ?? v.yieldFruitsPerMaturePlant, v.yieldFruitsPerMaturePlant),
              harvestDaysGrafted: num(patch.harvestDaysGrafted ?? v.harvestDaysGrafted, v.harvestDaysGrafted),
              harvestDaysUnrooted: num(patch.harvestDaysUnrooted ?? v.harvestDaysUnrooted, v.harvestDaysUnrooted),
              callusingDays: num(patch.callusingDays ?? v.callusingDays, v.callusingDays),
              rootWeeksDefault: num(patch.rootWeeksDefault ?? v.rootWeeksDefault, v.rootWeeksDefault),
              cuttingReadyBaseWeeks: num(patch.cuttingReadyBaseWeeks ?? v.cuttingReadyBaseWeeks, v.cuttingReadyBaseWeeks),
              cuttingUnrootedModifierWeeks: numAllowZero(
                patch.cuttingUnrootedModifierWeeks ?? v.cuttingUnrootedModifierWeeks,
                v.cuttingUnrootedModifierWeeks,
              ),
            },
          };
        }),

      reset: () => set({ values: { ...DEFAULT_ASSUMPTIONS } }),
    }),
    {
      name: 'dfd-assumptions',
      onRehydrateStorage: () => (state) => {
        if (state && state._seeded < SEED_VERSION) {
          // Merge new default keys onto the persisted values so a seed bump that
          // only ADDS assumptions (e.g. the cuttings fields) doesn't discard the
          // user's existing edits to the older ones.
          state.values = { ...DEFAULT_ASSUMPTIONS, ...state.values };
          state._seeded = SEED_VERSION;
        }
      },
    },
  ),
);

/** Non-reactive read of the current assumptions (for stores/utils outside React). */
export function getAssumptions(): LifecycleAssumptions {
  return useAssumptionsStore.getState().values;
}
