import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '../types';
import { generateId, now } from '../utils/id';

interface ProductState {
  products: Product[];
  _seeded: number; // version flag — bump to force re-seed
  addProduct: (data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Product;
  updateProduct: (id: string, data: Partial<Omit<Product, 'id' | 'createdAt'>>) => void;
  deleteProduct: (id: string) => void;
  getProduct: (id: string) => Product | undefined;
  /** Find a product by (category, subcategory), case/whitespace-insensitive. */
  findByCategorySub: (category: string, subcategory: string) => Product | undefined;
  /**
   * Find-or-create a product from a purchase observation (e.g. an itemized
   * expense line). Creates it with the given unit and `costPHP` when new;
   * backfills a missing unit or a zero cost on an existing row without
   * overwriting values the user has already set. Selling price is never touched.
   */
  upsertFromPurchase: (input: { category: string; subcategory: string; unit: string; costPHP: number }) => Product;
  /** Products that have a selling price set (₱ > 0) */
  pricedCount: () => number;
  /** Average margin % across priced products */
  averageMarginPct: () => number;
  /** Count grouped by category (e.g. Fruit, Cuttings, Fertilizer) */
  countByCategory: () => Record<string, number>;
}

/**
 * Build a product row cleanly.
 *
 * `category` is the coarse taxonomy (Cuttings, Fruit, Fertilizer…) and
 * `subcategory` the variety/specific item.
 */
function p(
  category: string,
  subcategory: string,
  costPHP: number,
  sellingPricePHP: number,
  costUSD: number,
  sellingPriceUSD: number,
  unit: string,
  notes = ''
): Product {
  return {
    id: generateId(),
    category,
    subcategory,
    costPHP,
    sellingPricePHP,
    costUSD,
    sellingPriceUSD,
    unit,
    notes,
    createdAt: now(),
    updatedAt: now(),
  };
}

// Seed version — increment this number to force all users to get fresh seed data
// v4: synced to the Bulacan Dragon Fruit Depot bookkeeping sheet — 30 real
// varieties (fruit + cuttings) with real prices, and real fertilizer prices.
const SEED_VERSION = 4;

const SEED_PRODUCTS: Product[] = [
  // ── Fruit (₱/kg) ────────────────────────────────────────────────────────────
  p('Fruit', 'Thai White',              400, 600, 0, 0, 'Kg', 'Premium variety'),
  p('Fruit', 'Vietnamese White',        350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Moroccan Red',            350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Red Jaina',               350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Philippine Purple',       350, 500, 0, 0, 'Kg'),
  p('Fruit', 'American Beauty',         350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Sugar Dragon',            350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Ecuador Palora',          350, 500, 0, 0, 'Kg'),
  p('Fruit', 'AX Hybrid',               350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Asunta 5 Paco',           350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Physical Graffiti',       350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Siam Magenta',            350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Honey White',             350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Nicaraguan Red',          350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Australian Isis Yellow',  350, 500, 0, 0, 'Kg'),
  p('Fruit', "Halley's Comet",          350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Delight',                 350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Voodoo Child',            350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Rainbow Dragon',          350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Seoul Kitchen',           350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Purple Haze',             500, 700, 0, 0, 'Kg', 'Premium variety'),
  p('Fruit', 'Dark Star',               350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Guatemalan Red',          350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Condon',                  350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Zamora',                  350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Bruni',                   350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Connie Mayer',            350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Zebra',                   350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Yellow Dragon',           350, 500, 0, 0, 'Kg'),
  p('Fruit', 'Orejona',                 350, 500, 0, 0, 'Kg'),

  // ── Cuttings (₱/piece) ───────────────────────────────────────────────────────
  // Orders under 25 cuttings incur a +₱100/cutting surcharge, applied in Sales.
  p('Cuttings', 'Thai White',             35, 300, 0, 10, 'Piece', 'Under 25 cuttings: +₱100 per cutting surcharge'),
  p('Cuttings', 'Vietnamese White',       35, 300, 0, 10, 'Piece', 'Low Stock — buy, graft then plant, wait until it has roots then sell'),
  p('Cuttings', 'Moroccan Red',           35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Red Jaina',              35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Philippine Purple',      50, 350, 0, 10, 'Piece'),
  p('Cuttings', 'American Beauty',        35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Sugar Dragon',           35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Ecuador Palora',         35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'AX Hybrid',              35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Asunta 5 Paco',          35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Physical Graffiti',      35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Siam Magenta',           35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Honey White',            35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Nicaraguan Red',         35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Australian Isis Yellow', 35, 300, 0, 10, 'Piece'),
  p('Cuttings', "Halley's Comet",         35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Delight',                35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Voodoo Child',           35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Rainbow Dragon',         35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Seoul Kitchen',          35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Purple Haze',            35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Dark Star',              35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Guatemalan Red',         35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Condon',                 35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Zamora',                 35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Bruni',                  35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Connie Mayer',           35, 300, 0, 10, 'Piece'),
  p('Cuttings', 'Zebra',                  40, 450, 0, 10, 'Piece'),
  p('Cuttings', 'Yellow Dragon',          35, 300, 0, 11, 'Piece'),
  p('Cuttings', 'Orejona',                35, 300, 0, 12, 'Piece'),

  // ── Fertilizers ──────────────────────────────────────────────────────────
  p('Fertilizer', 'Magnesium',      410,    1150, 0, 0, 'Bottle', 'Future Project: Manufactured Internally'),
  p('Fertilizer', 'Vermicast Worm', 500,     900, 0, 0, 'Sack'),
  p('Fertilizer', 'Cocopeat',       220,     500, 0, 0, 'Sack'),
  p('Fertilizer', 'Chicken Manure',  70,     170, 0, 0, 'Sack'),
  p('Fertilizer', 'Rice Hull',       75,     170, 0, 0, 'Sack'),
  p('Fertilizer', 'CRH',             30,     150, 0, 0, 'Sack'),
  p('Fertilizer', 'Neem Oil',       184.5,     0, 0, 0, 'Bottle', 'Selling price TBD'),
  p('Fertilizer', 'Nordox',        2000,    3000, 0, 0, 'Jug'),
  p('Fertilizer', 'Carbomax',          0,      0, 0, 0, 'Sack',   'Cost and selling price TBD'),

  // ── Other Products ────────────────────────────────────────────────────────
  p('Other', 'Webinar', 0, 1100, 0, 20, 'session', '2 Hours Duration'),
  p('Drink', '',        0,    0, 0,  0, 'unit',    'Selling price TBD'),
];

export const useProductStore = create<ProductState>()(
  persist(
    (set, get) => ({
      products: SEED_PRODUCTS,
      _seeded: SEED_VERSION,

      addProduct: (data) => {
        const product: Product = {
          ...data,
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ products: [...state.products, product] }));
        return product;
      },

      updateProduct: (id, data) =>
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...p, ...data, updatedAt: now() } : p
          ),
        })),

      deleteProduct: (id) =>
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
        })),

      getProduct: (id) => get().products.find((p) => p.id === id),

      findByCategorySub: (category, subcategory) => {
        const norm = (s: string) => s.trim().toLowerCase();
        const c = norm(category);
        const sub = norm(subcategory);
        return get().products.find(
          (p) => norm(p.category) === c && norm(p.subcategory) === sub,
        );
      },

      upsertFromPurchase: ({ category, subcategory, unit, costPHP }) => {
        const cat = category.trim();
        const sub = subcategory.trim();
        const u = unit.trim();
        const cost = Number(costPHP) || 0;
        const existing = get().findByCategorySub(cat, sub);
        if (existing) {
          // Backfill a missing unit / zero cost from this purchase, but never
          // overwrite values the user already set (unit, cost, or selling price).
          const patch: Partial<Product> = {};
          if (!existing.unit && u) patch.unit = u;
          if ((existing.costPHP ?? 0) === 0 && cost > 0) patch.costPHP = cost;
          if (Object.keys(patch).length > 0) {
            set((state) => ({
              products: state.products.map((p) =>
                p.id === existing.id ? { ...p, ...patch, updatedAt: now() } : p,
              ),
            }));
            return { ...existing, ...patch };
          }
          return existing;
        }
        const product: Product = {
          id: generateId(),
          category: cat,
          subcategory: sub,
          costPHP: cost,
          sellingPricePHP: 0,
          costUSD: 0,
          sellingPriceUSD: 0,
          unit: u,
          notes: '',
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ products: [...state.products, product] }));
        return product;
      },

      pricedCount: () => get().products.filter((p) => p.sellingPricePHP > 0).length,

      averageMarginPct: () => {
        const priced = get().products.filter((p) => p.sellingPricePHP > 0);
        if (priced.length === 0) return 0;
        const sum = priced.reduce(
          (acc, p) => acc + ((p.sellingPricePHP - p.costPHP) / p.sellingPricePHP) * 100,
          0
        );
        return sum / priced.length;
      },

      countByCategory: () =>
        get().products.reduce<Record<string, number>>((acc, p) => {
          acc[p.category] = (acc[p.category] ?? 0) + 1;
          return acc;
        }, {}),
    }),
    {
      name: 'dfd-products',
      // If stored seed version is older than current, replace seed data
      onRehydrateStorage: () => (state) => {
        if (state && state._seeded < SEED_VERSION) {
          state.products = SEED_PRODUCTS;
          state._seeded = SEED_VERSION;
        }
      },
    }
  )
);
