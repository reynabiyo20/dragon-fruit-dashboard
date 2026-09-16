import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BusinessInfo } from '../types';

interface BusinessState {
  info: BusinessInfo;
  setInfo: (info: Partial<BusinessInfo>) => void;
  resetInfo: () => void;
}

const defaultInfo: BusinessInfo = {
  businessName: 'Dragon Fruit Depot',
  owner: 'Kevin & Krizza Eliscupides',
  farmAddress: 'Bulacan, Philippines',
  startedYear: 2020,
  fiscalYear: new Date().getFullYear(),
  banks: ['BDO', 'BPI', 'PBCOm', 'Gcash', 'Zelle'],
  notes: '',
};

export const useBusinessStore = create<BusinessState>()(
  persist(
    (set) => ({
      info: defaultInfo,
      setInfo: (partial) =>
        set((state) => ({ info: { ...state.info, ...partial } })),
      resetInfo: () => set({ info: defaultInfo }),
    }),
    { name: 'dfd-business' }
  )
);
