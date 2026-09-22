import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Vendor, VendorSupply } from '../types';
import { generateId, now } from '../utils/id';
import { PHILIPPINES } from '../constants/geography';
import { cascadeVendorName } from './entityNameCascade';

// v3: adds a required { province, municipality } location.
// v4: adds location.country (defaults to Philippines for existing records).
const SEED_VERSION = 4;

function v(vendor: string, supplies: VendorSupply[]): Vendor {
  return {
    id: generateId(),
    vendor,
    contact: '',
    phone: '',
    location: { country: PHILIPPINES, province: '', municipality: '' },
    supplies,
    notes: '',
    createdAt: now(),
    updatedAt: now(),
  };
}

/** Shape of a persisted vendor that may still carry the old free-text fields */
type LegacyVendor = Vendor & { suppliesPurchased?: string; suppliesDetails?: string };

const SEED_VENDORS: Vendor[] = [
  v('Sample Vendor', [{ category: 'Fertilizer', subcategory: 'Magnesium' }]),
];

/** Convert legacy free-text supplies into the structured list (best-effort) */
function migrateLegacySupplies(vendor: LegacyVendor): VendorSupply[] {
  if (vendor.supplies && vendor.supplies.length > 0) return vendor.supplies;
  const cats = (vendor.suppliesPurchased ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const detail = (vendor.suppliesDetails ?? '').trim();
  if (cats.length === 0) return [];
  // Pair the first category with the detail (if any); the rest get no subcategory
  return cats.map((category, i) => ({
    category,
    subcategory: i === 0 ? detail : '',
  }));
}

interface VendorState {
  vendors: Vendor[];
  _seeded: number;
  // `location` is optional here so vendors auto-created from other flows
  // (expense/inventory entry) don't have to supply one — it defaults to empty
  // and can be filled in later via the Vendor form (where it's required).
  addVendor: (data: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt' | 'location'> & { location?: Vendor['location'] }) => Vendor;
  updateVendor: (id: string, data: Partial<Omit<Vendor, 'id' | 'createdAt'>>) => void;
  deleteVendor: (id: string) => void;
  getVendor: (id: string) => Vendor | undefined;
  /** Add a supply to a vendor if not already present (silent auto-learn) */
  addSupply: (vendorId: string, category: string, subcategory: string) => boolean;
  /** Vendors that supply a given category (+ optional subcategory) */
  vendorsForSupply: (category: string, subcategory?: string) => Vendor[];
  /** Count of vendors grouped by supply category */
  countBySupply: () => Record<string, number>;
}

export const useVendorStore = create<VendorState>()(
  persist(
    (set, get) => ({
      vendors: SEED_VENDORS,
      _seeded: SEED_VERSION,

      addVendor: (data) => {
        const vendor: Vendor = {
          ...data,
          location: data.location ?? { country: PHILIPPINES, province: '', municipality: '' },
          supplies: data.supplies ?? [],
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ vendors: [...state.vendors, vendor] }));
        return vendor;
      },

      updateVendor: (id, data) => {
        set((state) => ({
          vendors: state.vendors.map((vend) =>
            vend.id === id ? { ...vend, ...data, updatedAt: now() } : vend
          ),
        }));
        // Propagate a renamed vendor to the expenses that snapshot the vendor
        // name (matched by vendorId).
        if (data.vendor !== undefined) {
          const updated = get().vendors.find((v2) => v2.id === id);
          if (updated) cascadeVendorName(id, updated.vendor);
        }
      },

      deleteVendor: (id) =>
        set((state) => ({ vendors: state.vendors.filter((vend) => vend.id !== id) })),

      getVendor: (id) => get().vendors.find((vend) => vend.id === id),

      addSupply: (vendorId, category, subcategory) => {
        const vendor = get().vendors.find((v2) => v2.id === vendorId);
        if (!vendor) return false;
        // Store trimmed values, and match case-insensitively so casing/whitespace
        // drift between a catalog product and an existing supply doesn't create a
        // duplicate (and so the Vendors page / category filter stay aligned).
        const cat = category.trim();
        const sub = subcategory.trim();
        if (!cat) return false;
        const norm = (s: string) => s.trim().toLowerCase();
        const exists = (vendor.supplies ?? []).some(
          (s) => norm(s.category) === norm(cat) && norm(s.subcategory) === norm(sub)
        );
        if (exists) return false;
        set((state) => ({
          vendors: state.vendors.map((vend) =>
            vend.id === vendorId
              ? { ...vend, supplies: [...(vend.supplies ?? []), { category: cat, subcategory: sub }], updatedAt: now() }
              : vend
          ),
        }));
        return true;
      },

      vendorsForSupply: (category, subcategory) =>
        get().vendors.filter((vend) =>
          (vend.supplies ?? []).some(
            (s) =>
              s.category === category &&
              (subcategory === undefined || subcategory === '' || s.subcategory === subcategory || s.subcategory === '')
          )
        ),

      countBySupply: () =>
        get().vendors.reduce<Record<string, number>>((acc, vend) => {
          const cats = new Set((vend.supplies ?? []).map((s) => s.category));
          if (cats.size === 0) {
            acc['Unspecified'] = (acc['Unspecified'] ?? 0) + 1;
          } else {
            cats.forEach((c) => { acc[c] = (acc[c] ?? 0) + 1; });
          }
          return acc;
        }, {}),
    }),
    {
      name: 'dfd-vendors',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Migrate legacy free-text supplies into the structured list, and
        // default the location on records that predate the location feature.
        state.vendors = state.vendors.map((vend) => ({
          ...vend,
          location: {
            country: vend.location?.country ?? PHILIPPINES,
            province: vend.location?.province ?? '',
            municipality: vend.location?.municipality ?? '',
          },
          supplies: migrateLegacySupplies(vend),
        }));
        // Re-seed only if never seeded at this version AND there are no vendors
        if (state._seeded < SEED_VERSION && state.vendors.length === 0) {
          state.vendors = SEED_VENDORS;
        }
        state._seeded = SEED_VERSION;
      },
    }
  )
);
