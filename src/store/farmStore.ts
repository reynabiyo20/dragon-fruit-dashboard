import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FarmSection, StandingPlanting } from '../types';
import { generateId, now } from '../utils/id';

type NewPlanting = Omit<StandingPlanting, 'id' | 'createdAt' | 'updatedAt'>;

interface FarmState {
  sections: FarmSection[];
  /** Living plant populations (variety × section) — the actual orchard. */
  plantings: StandingPlanting[];
  _seeded: number;
  addSection: (data: Omit<FarmSection, 'id' | 'createdAt' | 'updatedAt'>) => FarmSection;
  updateSection: (id: string, data: Partial<Omit<FarmSection, 'id' | 'createdAt'>>) => void;
  deleteSection: (id: string) => void;
  getSection: (id: string) => FarmSection | undefined;
  totalArea: () => number;
  totalPlantCapacity: () => number;
  /** Plants per Sqm for a given section */
  plantDensity: (sectionId: string) => number;

  // ── Standing plants ──────────────────────────────────────────────────────
  addPlanting: (data: NewPlanting) => StandingPlanting;
  updatePlanting: (id: string, data: Partial<Omit<StandingPlanting, 'id' | 'createdAt'>>) => void;
  deletePlanting: (id: string) => void;
  /** Plantings in a section. */
  plantingsForSection: (sectionId: string) => StandingPlanting[];
  /** Total living plants grouped by variety across all sections. */
  standingByVariety: () => Record<string, number>;
  /** Total living plants of one variety across all sections. */
  plantsForVariety: (subcategory: string) => number;
  /** Distinct varieties actually planted in a section (from its standing plantings). */
  varietiesForSection: (sectionId: string) => string[];
  /** Living plant count of one variety in one section (sum of matching plantings). */
  plantsForSectionVariety: (sectionId: string, subcategory: string) => number;
  /**
   * Find-or-create the planting a cutting batch graduates into (keyed by
   * sourceBatchId), so a planted batch becomes standing plants exactly once.
   */
  upsertFromBatch: (input: {
    sourceBatchId: string;
    sectionId: string;
    subcategory: string;
    cuttingType?: string;
    plantCount: number;
    plantedDate?: string;
  }) => StandingPlanting;
  /** Remove the planting that graduated from a given batch (batch un-planted). */
  removeForBatch: (sourceBatchId: string) => void;
}

const SEED_VERSION = 2;

function s(
  sectionType: string,
  area: number,
  unit: string,
  currentPlantCapacity: number,
  plantSubcategory: string,
  pic: string,
  notes = ''
): FarmSection {
  return {
    id: generateId(),
    sectionType,
    area,
    unit,
    currentPlantCapacity,
    plantSubcategory,
    pic,
    notes,
    createdAt: now(),
    updatedAt: now(),
  };
}

const SEED_SECTIONS: FarmSection[] = [
  s('Greenhouse', 1000, 'Sqm', 2000, '',        'Tiboy', ''),
  s('Greenhouse',  400, 'Sqm',  750, '',        'Aljun', ''),
  s('Post',          0, 'Sqm',  400, 'Thai Red', 'Aljun', '1 hectare = 4,000 plants (ideal)'),
  s('Trellis',       0, 'TBD',    0, 'TBD',     'TBD',   ''),
];

export const useFarmStore = create<FarmState>()(
  persist(
    (set, get) => ({
      sections: SEED_SECTIONS,
      plantings: [],
      _seeded: SEED_VERSION,

      addSection: (data) => {
        const section: FarmSection = { ...data, id: generateId(), createdAt: now(), updatedAt: now() };
        set((state) => ({ sections: [...state.sections, section] }));
        return section;
      },

      updateSection: (id, data) =>
        set((state) => ({
          sections: state.sections.map((sec) =>
            sec.id === id ? { ...sec, ...data, updatedAt: now() } : sec
          ),
        })),

      deleteSection: (id) =>
        set((state) => ({
          sections: state.sections.filter((sec) => sec.id !== id),
          // Cascade: a section's standing plants go with it.
          plantings: state.plantings.filter((p) => p.sectionId !== id),
        })),

      getSection: (id) => get().sections.find((sec) => sec.id === id),

      totalArea: () => get().sections.reduce((sum, sec) => sum + sec.area, 0),
      totalPlantCapacity: () => get().sections.reduce((sum, sec) => sum + sec.currentPlantCapacity, 0),

      plantDensity: (sectionId) => {
        const sec = get().sections.find((sec) => sec.id === sectionId);
        if (!sec || sec.area <= 0) return 0;
        return sec.currentPlantCapacity / sec.area;
      },

      // ── Standing plants ──────────────────────────────────────────────────
      addPlanting: (data) => {
        const planting: StandingPlanting = {
          ...data,
          plantCount: Number(data.plantCount) || 0,
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ plantings: [...state.plantings, planting] }));
        return planting;
      },

      updatePlanting: (id, data) =>
        set((state) => ({
          plantings: state.plantings.map((p) =>
            p.id === id ? { ...p, ...data, updatedAt: now() } : p
          ),
        })),

      deletePlanting: (id) =>
        set((state) => ({ plantings: state.plantings.filter((p) => p.id !== id) })),

      plantingsForSection: (sectionId) => get().plantings.filter((p) => p.sectionId === sectionId),

      standingByVariety: () =>
        get().plantings.reduce<Record<string, number>>((acc, p) => {
          const key = p.subcategory.trim() || 'Unspecified';
          acc[key] = (acc[key] ?? 0) + (Number(p.plantCount) || 0);
          return acc;
        }, {}),

      plantsForVariety: (subcategory) => {
        const norm = (s: string) => s.trim().toLowerCase();
        return get()
          .plantings.filter((p) => norm(p.subcategory) === norm(subcategory))
          .reduce((sum, p) => sum + (Number(p.plantCount) || 0), 0);
      },

      varietiesForSection: (sectionId) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const p of get().plantings) {
          if (p.sectionId !== sectionId) continue;
          const v = p.subcategory.trim();
          if (!v) continue;
          const key = v.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(v);
        }
        return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      },

      plantsForSectionVariety: (sectionId, subcategory) => {
        const norm = (s: string) => s.trim().toLowerCase();
        return get()
          .plantings.filter(
            (p) => p.sectionId === sectionId && norm(p.subcategory) === norm(subcategory),
          )
          .reduce((sum, p) => sum + (Number(p.plantCount) || 0), 0);
      },

      upsertFromBatch: (input) => {
        const existing = get().plantings.find((p) => p.sourceBatchId === input.sourceBatchId);
        if (existing) {
          set((state) => ({
            plantings: state.plantings.map((p) =>
              p.id === existing.id
                ? {
                    ...p,
                    sectionId: input.sectionId,
                    subcategory: input.subcategory,
                    cuttingType: input.cuttingType ?? p.cuttingType,
                    plantCount: Number(input.plantCount) || 0,
                    plantedDate: input.plantedDate ?? p.plantedDate,
                    updatedAt: now(),
                  }
                : p
            ),
          }));
          return { ...existing, ...input, plantCount: Number(input.plantCount) || 0 };
        }
        const planting: StandingPlanting = {
          id: generateId(),
          sectionId: input.sectionId,
          subcategory: input.subcategory,
          cuttingType: input.cuttingType,
          plantCount: Number(input.plantCount) || 0,
          plantedDate: input.plantedDate,
          matureFruiting: false,
          sourceBatchId: input.sourceBatchId,
          notes: 'Graduated from a planted cutting batch.',
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ plantings: [...state.plantings, planting] }));
        return planting;
      },

      removeForBatch: (sourceBatchId) =>
        set((state) => ({
          plantings: state.plantings.filter((p) => p.sourceBatchId !== sourceBatchId),
        })),
    }),
    {
      name: 'dfd-farm',
      onRehydrateStorage: () => (state) => {
        if (state && state._seeded < SEED_VERSION) {
          state.sections = SEED_SECTIONS;
          state._seeded = SEED_VERSION;
        }
      },
    }
  )
);
