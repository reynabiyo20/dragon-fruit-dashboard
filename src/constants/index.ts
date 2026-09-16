/**
 * Shared constants and option lists.
 *
 * Centralizing these avoids drift between forms (e.g. one form offering "pack"
 * as a unit while another offers "sack") and keeps dropdowns consistent with
 * store seed data.
 */

export interface Option {
  value: string;
  label: string;
}

/**
 * Build a value/label option list from plain strings, sorted alphabetically by
 * default (case-insensitive) so every dropdown is ordered consistently. Pass
 * `sorted = false` to preserve the given order when it's meaningful.
 */
export function toOptions(values: readonly string[], sorted = true): Option[] {
  const list = sorted
    ? [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    : values;
  return list.map((v) => ({ value: v, label: v }));
}

// ─── Sentinels ─────────────────────────────────────────────────────────────────
// Special dropdown values used to trigger manual entry / create-new flows.
export const MANUAL_ENTRY = '__manual__';
export const CREATE_NEW = '__new__';

// ─── Payment ─────────────────────────────────────────────────────────────────
export const PAYMENT_METHODS = ['Cash', 'Gcash', 'Zelle', 'Bank Transfer', 'Check', 'Other'] as const;
export const PAYMENT_OPTIONS = toOptions(PAYMENT_METHODS);

/** Payment methods that require a reference / account detail */
export const METHODS_REQUIRING_DETAILS = ['Bank Transfer', 'Gcash', 'Zelle', 'Check'];

// ─── Sales ───────────────────────────────────────────────────────────────────
/**
 * The "type" describes how a single sale happened (walk-in vs online, etc.), not
 * who the customer is. The same customer can transact under different sale types
 * on different days, so this lives on the Sale, not the Customer.
 */
export const ONLINE_ORDERS = 'Online Orders';

export const SALE_TYPES = [
  'Walk-In Consumer', 'S&R', ONLINE_ORDERS, 'Wholesale', 'Retailer', 'Other',
] as const;
export const SALE_TYPE_OPTIONS = toOptions(SALE_TYPES);

// ─── Employees ─────────────────────────────────────────────────────────────────
// Seed values for the editable employee-type option store (see optionStores.ts)
export const EMPLOYEE_TYPES = ['Full Time', 'Part Time', 'Contractual', 'Seasonal'] as const;

// ─── Units (products & inventory) ────────────────────────────────────────────
export const UNIT_VALUES = [
  'Kg', 'piece', 'bundle', 'bag', 'box', 'liter', 'pack', 'sack', 'roll', 'bottle', 'jug',
] as const;
export const UNIT_OPTIONS = toOptions(UNIT_VALUES);

// ─── Inventory categories ─────────────────────────────────────────────────────
// Aligned to the product taxonomy so a sold/purchased variety maps 1:1 to an
// inventory row. The first three MUST match the product types below (Cuttings,
// Fruit, Fertilizer); the rest are inventory-only categories with no product.
export const INVENTORY_CATEGORIES = [
  'Cuttings', 'Fruit', 'Fertilizer', 'Packing Material',
  'Tools', 'Construction Material', 'Grafting Supplies', 'Other',
] as const;
export const INVENTORY_CATEGORY_OPTIONS = toOptions(INVENTORY_CATEGORIES);

// ─── Dragon-fruit varieties ───────────────────────────────────────────────────
// The dragon-fruit varieties, reused as subcategories for the Fruit & Cuttings
// categories and by the cuttings tracker.
export const DRAGON_FRUIT_VARIETIES = [
  'Thai White',
  'Variety 2', 'Variety 3', 'Variety 4', 'Variety 5', 'Variety 6', 'Variety 7', 'Variety 8',
  'Variety 9', 'Variety 10', 'Variety 11', 'Variety 12', 'Variety 13', 'Variety 14', 'Variety 15',
] as const;

// ─── Product taxonomy (type → subcategory) ────────────────────────────────────
/**
 * Coarse product types. "Cuttings" is special: sales of cuttings below the
 * small-order threshold get the per-cutting surcharge (see CUTTING_* below).
 */
export const CUTTINGS_PRODUCT_TYPE = 'Cuttings';
export const FRUIT_PRODUCT_TYPE = 'Fruit';
export const FERTILIZER_PRODUCT_TYPE = 'Fertilizer';
export const DRINK_PRODUCT_TYPE = 'Drink';

export const PRODUCT_CATEGORY_TYPES = [
  CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE, DRINK_PRODUCT_TYPE, FERTILIZER_PRODUCT_TYPE, 'Other',
] as const;

/**
 * The fertilizer varieties, reused as subcategories for the Fertilizer product
 * type, inventory rows, and expense supplies so all three stay aligned.
 */
export const FERTILIZER_VARIETIES = [
  'Magnesium', 'Vermicast Worm', 'Cocopeat', 'Chicken Manure', 'Rice Hull',
  'CRH', 'Neem Oil', 'Nordox', 'Carbomax',
] as const;

/**
 * Product types whose (type, variety) pairs map onto inventory rows and are the
 * ones sales/expenses adjust. Drink is intentionally excluded — drink stock is
 * tracked manually (see the sold→inventory warning flow).
 */
export const INVENTORY_LINKED_TYPES = [
  CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE, FERTILIZER_PRODUCT_TYPE,
] as const;

/**
 * Seed for the managed product taxonomy (see productCategoryStore). Each pair is
 * a category + subcategory; '' subcategory means the category has no varieties.
 * Drink now carries the dragon-fruit varieties too (varieties apply to Fruit,
 * Cuttings, and Drink).
 */
export const PRODUCT_CATEGORY_SEED: readonly (readonly [string, string])[] = [
  ...DRAGON_FRUIT_VARIETIES.map((v) => [FRUIT_PRODUCT_TYPE, v] as const),
  ...DRAGON_FRUIT_VARIETIES.map((v) => [CUTTINGS_PRODUCT_TYPE, v] as const),
  ...DRAGON_FRUIT_VARIETIES.map((v) => [DRINK_PRODUCT_TYPE, v] as const),
  ...FERTILIZER_VARIETIES.map((v) => [FERTILIZER_PRODUCT_TYPE, v] as const),
  ['Other', 'Webinar'],
];

// ─── Fruit harvest window ──────────────────────────────────────────────────────
/**
 * Dragon fruit ripens roughly a month after flowering. The estimated harvest
 * window is flowering date + this many days, surfaced as a Month + Week so the
 * Production view can highlight batches entering their harvest window.
 */
export const FRUIT_DAYS_FLOWER_TO_HARVEST = 30;

// ─── Wholesale forecasting engine ──────────────────────────────────────────────
/**
 * Parameters for projecting future wholesale fruit supply from deployed cuttings.
 * "Deployed" means the cutting is in the ground: an internal batch marked Planted,
 * or a customer/partner batch whose sale was marked Delivered.
 */
/** Average weight of a single dragon fruit (kg). 1 piece = 450 g. */
export const FRUIT_WEIGHT_KG = 0.45;

/** First-harvest yield in fruits per plant/cutting, by cutting type. */
export const YIELD_FRUITS_GRAFTED = 15;   // ≈ 6.75 kg per grafted cutting
export const YIELD_FRUITS_UNROOTED = 5;   // ≈ 2.25 kg per unrooted cutting

/**
 * Days from deployment (planted / delivered) to the first projected harvest,
 * by cutting type. Grafted stock fruits within its first season; unrooted needs
 * roughly a full year to establish and fruit.
 */
export const HARVEST_DAYS_GRAFTED = 180;
export const HARVEST_DAYS_UNROOTED = 365;

/**
 * Dragon fruit has a tropical off-season roughly November–April. A projected
 * harvest that lands inside it is rolled forward to the start of the season,
 * surfaced as this label.
 */
export const OFF_SEASON_MONTHS = [11, 12, 1, 2, 3, 4]; // Nov–Apr (1-based months)
export const EARLY_SEASON_LABEL = 'May (Early Season)';

// ─── Farm ──────────────────────────────────────────────────────────────────────
export const FARM_SECTION_TYPES = ['Greenhouse', 'Post', 'Trellis', 'Open Field', 'Nursery', 'Other'] as const;
export const FARM_SECTION_TYPE_OPTIONS = toOptions(FARM_SECTION_TYPES);
export const FARM_AREA_UNITS = ['Sqm', 'Hectare', 'Acre', 'TBD'] as const;
export const FARM_AREA_UNIT_OPTIONS = toOptions(FARM_AREA_UNITS);

// ─── Thresholds ─────────────────────────────────────────────────────────────────
/** Inventory items at or below this ending qty (with a unit cost) are flagged low-stock */
export const LOW_STOCK_THRESHOLD = 5;

// ─── Cuttings (grafted dragon-fruit cuttings sourced from a friend) ────────────
/**
 * Business rules for the cuttings side of the operation:
 *  - Cuttings are sourced from a friend at a per-cutting cost, then grafted and
 *    planted. They take 2–4 weeks to root before they can be sold.
 *  - Rooted cuttings sell at a base price. Orders below a minimum quantity carry
 *    a per-cutting surcharge (small-order fee).
 * These are seed defaults; each batch/sale can override the numbers if prices change.
 */
/** Default cost to source one cutting from the friend (₱) */
export const CUTTING_SOURCE_COST = 35;
/** Default base selling price per rooted cutting (₱) */
export const CUTTING_BASE_PRICE = 300;
/** Extra charge per cutting when an order is below the small-order threshold (₱) */
export const CUTTING_SMALL_ORDER_SURCHARGE = 100;
/** Orders with fewer than this many cuttings incur the small-order surcharge */
export const CUTTING_SMALL_ORDER_THRESHOLD = 25;
/** Earliest / typical / latest number of weeks a grafted cutting needs to root */
export const CUTTING_ROOT_WEEKS_MIN = 2;
export const CUTTING_ROOT_WEEKS_DEFAULT = 3;
export const CUTTING_ROOT_WEEKS_MAX = 4;

/**
 * Lifecycle status of a cutting batch. Derived from dates + quantity sold:
 *  - Sourced:  bought but not yet grafted
 *  - Rooting:  grafted, still within the rooting window (not yet sellable)
 *  - Ready:    past the rooting window, cuttings available to sell
 *  - Sold Out: every rooted cutting has been sold
 */
/**
 * Status flow once an internal batch reaches its estimated ready date:
 *  1. "Rooted & Ready to Pack" — auto milestone; staff must pack it.
 *  2. "Packed & Ready for Delivery" — set when staff clicks "Mark as Packed";
 *     at that moment the quantity is released into Available Stock for Sale.
 */
export const CUTTING_STATUS_ROOTED_READY = 'Rooted & Ready to Pack';
export const CUTTING_STATUS_PACKED = 'Packed & Ready for Delivery';

export const CUTTING_STATUSES = [
  'In Nursery / Callusing', 'Sourced', 'Rooting', 'Ready',
  CUTTING_STATUS_ROOTED_READY, CUTTING_STATUS_PACKED, 'Sold Out',
] as const;

// ─── Cuttings allocation (post-rooting destination) ────────────────────────────
/**
 * Once an internal batch is rooted & ready, the user flags where it goes:
 *  - For Delivery:        released to the Available-Stock-for-Sale pool.
 *  - For Replant in Farm: added to Our Farm Breeding Stock.
 */
export const CUTTING_ALLOCATION_DELIVERY = 'For Delivery';
export const CUTTING_ALLOCATION_REPLANT = 'For Replant in Farm';
export const CUTTING_ALLOCATIONS = [CUTTING_ALLOCATION_DELIVERY, CUTTING_ALLOCATION_REPLANT] as const;
export const CUTTING_ALLOCATION_OPTIONS = toOptions(CUTTING_ALLOCATIONS, false);

/**
 * Internally harvested cuttings must callus/heal for a fixed hold before their
 * growth countdown begins. During this window the batch is "In Nursery /
 * Callusing" and the planting/acquisition date is the harvest date + this many
 * days. Customer-sourced records skip this delay entirely.
 */
export const CUTTING_CALLUSING_DAYS = 14;

// ─── Farm Partners (customers who also sell to us) ─────────────────────────────
/**
 * A "Farm Partner" is a customer who also acts as a vendor — the business buys
 * fruit and/or cuttings from them. When a customer is flagged as a Farm Partner
 * their profile cascades into the Vendors module (see customerStore).
 *
 * `category` scopes WHAT they supply; the subcategory options are scoped from it.
 */
export const FARM_PARTNER_CATEGORY_FRUIT = 'Fruit';
export const FARM_PARTNER_CATEGORY_CUTTINGS = 'Cuttings';
export const FARM_PARTNER_CATEGORY_BOTH = 'Both';

export const FARM_PARTNER_CATEGORIES = [
  FARM_PARTNER_CATEGORY_FRUIT,
  FARM_PARTNER_CATEGORY_CUTTINGS,
  FARM_PARTNER_CATEGORY_BOTH,
] as const;
export const FARM_PARTNER_CATEGORY_OPTIONS = toOptions(FARM_PARTNER_CATEGORIES, false);

/**
 * Fruit subcategories offered to Farm Partners. Kept alongside the variety list
 * so a partner can supply by fruit colour as well as by named variety.
 */
export const FRUIT_SUBCATEGORIES = ['Red', 'White', 'Yellow'] as const;

/**
 * Subcategory options for a Farm Partner, scoped by their selected category:
 *  - Fruit    → fruit colours
 *  - Cuttings → dragon-fruit varieties
 *  - Both     → merged, de-duplicated list of the above
 */
export function farmPartnerSubcategoryOptions(category: string): Option[] {
  if (category === FARM_PARTNER_CATEGORY_FRUIT) {
    return toOptions(FRUIT_SUBCATEGORIES);
  }
  if (category === FARM_PARTNER_CATEGORY_CUTTINGS) {
    return toOptions(DRAGON_FRUIT_VARIETIES);
  }
  if (category === FARM_PARTNER_CATEGORY_BOTH) {
    return toOptions([...new Set<string>([...FRUIT_SUBCATEGORIES, ...DRAGON_FRUIT_VARIETIES])]);
  }
  return [];
}

// ─── Cuttings Store — origin flags & growth cycles ─────────────────────────────
/**
 * Every Cuttings Store record carries an origin flag:
 *  - Internal Batch: our own nursery propagation (manually created).
 *  - Customer:       cascaded automatically when a customer buys cuttings in Sales.
 */
export const CUTTING_SOURCE_INTERNAL = 'Internal Batch';
export const CUTTING_SOURCE_CUSTOMER = 'Customer';
export const CUTTING_SOURCES = [CUTTING_SOURCE_INTERNAL, CUTTING_SOURCE_CUSTOMER] as const;
export const CUTTING_SOURCE_OPTIONS = toOptions(CUTTING_SOURCES, false);

/**
 * Cutting type affects how long a cutting takes to be "ready":
 *  - Grafted (rooted): already has roots, shorter grow-out before it's sellable/plantable.
 *  - Unrooted:         a fresh cutting that must root first, so it needs longer.
 */
export const CUTTING_TYPE_GRAFTED = 'Grafted (rooted)';
export const CUTTING_TYPE_UNROOTED = 'Unrooted cutting';
export const CUTTING_TYPES = [CUTTING_TYPE_GRAFTED, CUTTING_TYPE_UNROOTED] as const;
export const CUTTING_TYPE_OPTIONS = toOptions(CUTTING_TYPES, false);

/**
 * Base grow-out weeks until a cutting is ready, before the cutting-type modifier.
 * Most dragon-fruit varieties behave similarly; a per-variety override lets slow
 * or fast varieties differ. The estimated ready date is:
 *   acquisitionDate + (baseWeeks(variety) + typeModifierWeeks(cuttingType))
 */
export const CUTTING_READY_BASE_WEEKS_DEFAULT = 4;

/** Per-variety base grow-out overrides (weeks). Falls back to the default above. */
export const CUTTING_VARIETY_READY_WEEKS: Readonly<Record<string, number>> = {
  'Thai White': 4,
};

/**
 * Extra weeks added on top of the variety base, by cutting type. An unrooted
 * cutting must root first, so it needs more time than an already-grafted one.
 */
export const CUTTING_TYPE_READY_MODIFIER_WEEKS: Readonly<Record<string, number>> = {
  [CUTTING_TYPE_GRAFTED]: 0,
  [CUTTING_TYPE_UNROOTED]: 3,
};

/**
 * Estimate how many weeks until a cutting of the given variety + type is ready.
 * Used to derive the estimated ready date in the Cuttings Store.
 */
export function cuttingReadyWeeks(variety: string, cuttingType: string): number {
  const base = CUTTING_VARIETY_READY_WEEKS[variety] ?? CUTTING_READY_BASE_WEEKS_DEFAULT;
  const modifier = CUTTING_TYPE_READY_MODIFIER_WEEKS[cuttingType] ?? 0;
  return base + modifier;
}
