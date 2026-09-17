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
 * Remove a product (by category+subcategory) from the sellable Products list when
 * it's safe to do so. Returns:
 *  - 'removed'     the product was auto-created & unused → deleted
 *  - 'kept-priced' it has a selling price the user set → kept
 *  - 'kept-sold'   it's referenced by a sale → kept
 *  - 'not-found'   no matching product
 */
export function unlinkResellProduct(category: string, subcategory: string): UnlinkResult {
  const productStore = useProductStore.getState();
  const product = productStore.findByCategorySub(category, subcategory);
  if (!product) return 'not-found';

  // Keep it if the user has set a selling price — that's deliberate sellable data.
  if (product.sellingPricePHP > 0) return 'kept-priced';

  // Keep it if any sale references this product — deleting would orphan history.
  const referenced = useSaleStore
    .getState()
    .sales.some((s) => s.items.some((i) => i.productId === product.id));
  if (referenced) return 'kept-sold';

  productStore.deleteProduct(product.id);
  return 'removed';
}
