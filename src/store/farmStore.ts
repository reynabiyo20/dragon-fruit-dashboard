import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FarmSection } from '../types';
import { generateId, now } from '../utils/id';

interface FarmState {
  sections: FarmSection[];
  _seeded: number;
  addSection: (data: Omit<FarmSection, 'id' | 'createdAt' | 'updatedAt'>) => FarmSection;
  updateSection: (id: string, data: Partial<Omit<FarmSection, 'id' | 'createdAt'>>) => void;
  deleteSection: (id: string) => void;
  getSection: (id: string) => FarmSection | undefined;
  totalArea: () => number;
  totalPlantCapacity: () => number;
  /** Plants per Sqm for a given section */
  plantDensity: (sectionId: string) => number;
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
        set((state) => ({ sections: state.sections.filter((sec) => sec.id !== id) })),

      getSection: (id) => get().sections.find((sec) => sec.id === id),

      totalArea: () => get().sections.reduce((sum, sec) => sum + sec.area, 0),
      totalPlantCapacity: () => get().sections.reduce((sum, sec) => sum + sec.currentPlantCapacity, 0),

      plantDensity: (sectionId) => {
        const sec = get().sections.find((sec) => sec.id === sectionId);
        if (!sec || sec.area <= 0) return 0;
        return sec.currentPlantCapacity / sec.area;
      },
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
