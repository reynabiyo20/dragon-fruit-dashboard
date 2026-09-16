import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId, now } from '../utils/id';

/**
 * Vendor-product catalog.
 *
 * A **VendorProduct** is a shared catalog entity — a named thing that can be
 * purchased (e.g. "Ammonium Sulfate 21-0-0"). It is intentionally NOT scoped to
 * a single vendor: the same product can be offered by many vendors. It carries
 * the category/subcategory it belongs to (so existing category filtering and
 * reports keep working) and a canonical unit of measure.
 *
 * Price is per-vendor, so it lives on a separate **VendorPrice** link
 * ({ vendorId, productId, defaultPrice }). The default price prefills an expense
 * line but stays editable per purchase.
 *
 * Snapshots of name/unit/price are copied onto each ExpenseItem at save time, so
 * later edits to the catalog never rewrite historical expense records.
 */

export interface VendorProduct {
  id: string;
  name: string;
  category: string;
  subcategory: string; // '' when the category has no subcategory
  unit: string;        // canonical unit of measure (Kg, sack, box…); '' if unset
  createdAt: string;
  updatedAt: string;
}

/** Per-vendor editable default price for a product */
export interface VendorPrice {
  vendorId: string;
  productId: string;
  defaultPrice: number;
}

/** Normalize a product identity for de-duplication (case/space-insensitive) */
function productKey(name: string, category: string, subcategory: string): string {
  return `${name.trim().toLowerCase()}||${category.trim().toLowerCase()}||${subcategory.trim().toLowerCase()}`;
}

interface VendorProductState {
  products: VendorProduct[];
  prices: VendorPrice[];

  /**
   * Find or create a shared product by (name, category, subcategory). Returns
   * the existing or newly-created product. Unit is set on create, and filled in
   * later if the existing product had no unit.
   */
  addProduct: (input: { name: string; category: string; subcategory: string; unit: string }) => VendorProduct;

  /** Update a product's editable fields (name/unit). Category/subcategory are stable. */
  updateProduct: (id: string, data: Partial<Pick<VendorProduct, 'name' | 'unit'>>) => void;

  /**
   * Move a product to a new category/subcategory. Used by the category-rename
   * cascade so the catalog stays aligned with the managed category taxonomy.
   */
  updateProductCategory: (id: string, category: string, subcategory: string) => void;

  /** Remove a product and any per-vendor price links to it. */
  deleteProduct: (id: string) => void;

  getProduct: (id: string) => VendorProduct | undefined;

  /** Products a given vendor offers (i.e. has a price link for), optionally filtered by category. */
  productsFor: (vendorId: string, category?: string) => VendorProduct[];

  /** Categories a vendor offers products in (distinct, sorted). */
  categoriesFor: (vendorId: string) => string[];

  /** The vendor's default price for a product, or undefined when no link exists. */
  priceFor: (vendorId: string, productId: string) => number | undefined;

  /**
   * Create or update a vendor's default price for a product. Passing a price of
   * undefined creates the link with price 0 (offered but unpriced).
   */
  linkVendorPrice: (vendorId: string, productId: string, defaultPrice?: number) => void;

  /** Remove a vendor's link to a product (no longer offered by that vendor). */
  unlinkVendorPrice: (vendorId: string, productId: string) => void;
}

export const useVendorProductStore = create<VendorProductState>()(
  persist(
    (set, get) => ({
      products: [],
      prices: [],

      addProduct: ({ name, category, subcategory, unit }) => {
        const key = productKey(name, category, subcategory);
        const existing = get().products.find(
          (p) => productKey(p.name, p.category, p.subcategory) === key
        );
        if (existing) {
          // Backfill a missing unit from this observation, but don't overwrite one
          if (!existing.unit && unit) {
            set((state) => ({
              products: state.products.map((p) =>
                p.id === existing.id ? { ...p, unit, updatedAt: now() } : p
              ),
            }));
            return { ...existing, unit };
          }
          return existing;
        }
        const product: VendorProduct = {
          id: generateId(),
          name: name.trim(),
          category: category.trim(),
          subcategory: subcategory.trim(),
          unit: unit.trim(),
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

      updateProductCategory: (id, category, subcategory) =>
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id
              ? { ...p, category: category.trim(), subcategory: subcategory.trim(), updatedAt: now() }
              : p
          ),
        })),

      deleteProduct: (id) =>
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
          prices: state.prices.filter((pr) => pr.productId !== id),
        })),

      getProduct: (id) => get().products.find((p) => p.id === id),

      productsFor: (vendorId, category) => {
        const linkedIds = new Set(
          get().prices.filter((pr) => pr.vendorId === vendorId).map((pr) => pr.productId)
        );
        return get()
          .products.filter(
            (p) => linkedIds.has(p.id) && (category === undefined || p.category === category)
          )
          .sort((a, b) => a.name.localeCompare(b.name));
      },

      categoriesFor: (vendorId) => {
        const linkedIds = new Set(
          get().prices.filter((pr) => pr.vendorId === vendorId).map((pr) => pr.productId)
        );
        const cats = get()
          .products.filter((p) => linkedIds.has(p.id))
          .map((p) => p.category);
        return [...new Set(cats)].sort();
      },

      priceFor: (vendorId, productId) =>
        get().prices.find((pr) => pr.vendorId === vendorId && pr.productId === productId)
          ?.defaultPrice,

      linkVendorPrice: (vendorId, productId, defaultPrice) =>
        set((state) => {
          const idx = state.prices.findIndex(
            (pr) => pr.vendorId === vendorId && pr.productId === productId
          );
          const price = defaultPrice ?? 0;
          if (idx === -1) {
            return { prices: [...state.prices, { vendorId, productId, defaultPrice: price }] };
          }
          return {
            prices: state.prices.map((pr, i) =>
              i === idx ? { ...pr, defaultPrice: price } : pr
            ),
          };
        }),

      unlinkVendorPrice: (vendorId, productId) =>
        set((state) => ({
          prices: state.prices.filter(
            (pr) => !(pr.vendorId === vendorId && pr.productId === productId)
          ),
        })),
    }),
    { name: 'dfd-vendor-products' }
  )
);
