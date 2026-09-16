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
const SEED_VERSION = 3;

const SEED_PRODUCTS: Product[] = [
  // ── Fruit ─────────────────────────────────────────────────────────────────
  p('Fruit', 'Thai White',  0, 0, 0, 0, 'Kg', 'Not Exported Currently, Over 200 Varieties'),
  p('Fruit', 'Variety 2',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 3',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 4',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 5',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 6',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 7',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 8',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 9',   0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 10',  0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 11',  0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 12',  0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 13',  0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 14',  0, 0, 0, 0, 'Kg'),
  p('Fruit', 'Variety 15',  0, 0, 0, 0, 'Kg'),

  // ── Cuttings ──────────────────────────────────────────────────────────────
  // Orders under 25 cuttings incur a +₱100/cutting surcharge, applied in Sales.
  p('Cuttings', 'Thai White',  35,  300, 0, 10, 'Piece', 'Under 25 cuttings: +₱100 per cutting surcharge'),
  p('Cuttings', 'Variety 2',    0,    0, 0,  0, 'Piece', 'Low Stock — buy, graft then plant, wait until it has roots then sell'),
  p('Cuttings', 'Variety 3',    0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 4',    0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 5',    0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 6',    0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 7',    0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 8',    0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 9',    0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 10',   0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 11',   0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 12',   0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 13',   0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 14',   0,    0, 0,  0, 'Piece'),
  p('Cuttings', 'Variety 15',   0,    0, 0,  0, 'Piece'),

  // ── Fertilizers ──────────────────────────────────────────────────────────
  p('Fertilizer', 'Magnesium',      410,    1150, 0, 0, 'Bottle', 'Future Project: Manufactured Internally'),
  p('Fertilizer', 'Vermicast Worm', 500,     900, 0, 0, 'Sack'),
  p('Fertilizer', 'Cocopeat',       220,     500, 0, 0, 'Sack'),
  p('Fertilizer', 'Chicken Manure',  70,     170, 0, 0, 'Sack'),
  p('Fertilizer', 'Rice Hull',       75,     170, 0, 0, 'Sack'),
  p('Fertilizer', 'CRH',             30,     150, 0, 0, 'Sack'),
  p('Fertilizer', 'Neem Oil',       184.5,     0, 0, 0, 'Bottle', 'Selling price TBD'),
  p('Fertilizer', 'Nordox',        2000,    3000, 0, 0, 'Jug'),
  p('Fertilizer', 'Carbomax',          0,      0, 0, 0, 'unit',   'Cost and selling price TBD'),

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
