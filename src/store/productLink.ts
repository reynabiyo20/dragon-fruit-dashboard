/**
 * Product resell (un)linking helpers.
 *
 * When a purchase is flagged "we resell this", the item is cascaded into the
 * sellable Products list. If the user later un-flags it, the product should be
 * removed from Products — but ONLY when it's safe: an auto-created row that
 * carries no selling price and isn't referenced by any sale. Inventory is never
 * touched by these helpers.
 */
import { useProductStore } from './productStore';
import { useSaleStore } from './saleStore';

export type UnlinkResult = 'removed' | 'kept-priced' | 'kept-sold' | 'not-found';

/**
 * Remove a product (by category+subcategory) from the sellable Products list.
 *
 * By default this is conservative — it only deletes an auto-created row that
 * carries no selling price and isn't referenced by a sale. Pass `force: true`
 * (used after an explicit user confirmation, e.g. unchecking "Do you sell this?")
 * to also remove a row that has a selling price set. A product referenced by a
 * recorded sale is NEVER deleted, even when forced, since that would orphan sales
 * history. Inventory is never touched.
 *
 * Returns:
 *  - 'removed'     the product was deleted
 *  - 'kept-priced' it has a selling price and `force` was not set → kept
 *  - 'kept-sold'   it's referenced by a sale → kept
 *  - 'not-found'   no matching product
 */
export function unlinkResellProduct(
  category: string,
  subcategory: string,
  options: { force?: boolean } = {},
): UnlinkResult {
  const productStore = useProductStore.getState();
  const product = productStore.findByCategorySub(category, subcategory);
  if (!product) return 'not-found';

  // Keep it if any sale references this product — deleting would orphan history.
  // This block holds even when forced.
  const referenced = useSaleStore
    .getState()
    .sales.some((s) => s.items.some((i) => i.productId === product.id));
  if (referenced) return 'kept-sold';

  // Without an explicit force, keep a product the user has priced — that's
  // deliberate sellable data we shouldn't silently drop.
  if (!options.force && product.sellingPricePHP > 0) return 'kept-priced';

  productStore.deleteProduct(product.id);
  return 'removed';
}
