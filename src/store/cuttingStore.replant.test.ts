import { describe, it, expect, beforeEach } from 'vitest';
import { useCuttingStore } from './cuttingStore';
import { useInventoryStore } from './inventoryStore';
import { useProductStore } from './productStore';
import { useExpenseCategoryStore } from './expenseCategoryStore';
import { generateId, now } from '../utils/id';
import {
  CUTTING_STATUS_ROOTED_READY, CUTTING_ALLOCATION_REPLANT, CUTTINGS_PRODUCT_TYPE,
} from '../constants';

/**
 * Reproduces the "Mark as Planted" button binding: a rooted-ready internal batch
 * flagged "For Replant in Farm" must keep status = "Rooted & Ready to Pack" and
 * carry allocation = "For Replant in Farm" so the row renders Mark as Planted.
 */
describe('cutting batch replant allocation → planted flow', () => {
  beforeEach(() => {
    useCuttingStore.setState({ batches: [] });
    useProductStore.setState({ products: [], _seeded: 999 });
    // Reset the shared inventory store to a single clean Thai White cuttings row
    // so breeding-stock assertions aren't polluted across tests.
    useInventoryStore.setState({
      items: [
        {
          id: generateId(),
          category: CUTTINGS_PRODUCT_TYPE,
          subcategory: 'Thai White',
          unit: 'piece',
          beginningQty: 0,
          purchased: 0,
          used: 0,
          sold: 0,
          endingQty: 0,
          unitCost: 0,
          breedingStock: 0,
          availableForSale: 0,
          notes: '',
          createdAt: now(),
          updatedAt: now(),
        },
      ],
      _seeded: 999,
    });
  });

  function addRootedReadyBatch() {
    // Harvest far in the past so the callusing hold + growth cycle have elapsed,
    // putting the batch in the rooted-ready state.
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return useCuttingStore.getState().addBatch({
      subcategory: 'Thai White',
      cuttingType: 'Grafted with Roots',
      harvestDate: longAgo,
      dateSourced: longAgo,
      dateGrafted: '',
      quantitySourced: 20,
      sourceCostPerCutting: 35,
      graftCostPerCutting: 0,
      rootWeeks: 3,
      quantitySold: 0,
      notes: '',
    });
  }

  it('a long-past internal batch is Rooted & Ready to Pack', () => {
    const b = addRootedReadyBatch();
    expect(b.status).toBe(CUTTING_STATUS_ROOTED_READY);
  });

  it('creating a batch cascades the variety into the Product catalog + expense taxonomy', () => {
    useExpenseCategoryStore.setState({ entries: [], _seeded: 999 });
    addRootedReadyBatch(); // variety "Thai White"
    const product = useProductStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White');
    expect(product).toBeDefined();
    expect(product?.category).toBe(CUTTINGS_PRODUCT_TYPE);
    // Also discoverable in the Expense form dropdowns.
    const inExpenseTaxonomy = useExpenseCategoryStore
      .getState()
      .entries.some((e) => e.category === CUTTINGS_PRODUCT_TYPE && e.subcategory === 'Thai White');
    expect(inExpenseTaxonomy).toBe(true);
  });

  it('creating a batch with a NEW variety auto-creates its Cuttings inventory row', () => {
    // Start with no inventory rows so we prove the row is created, not merged.
    useInventoryStore.setState({ items: [], _seeded: 999 });
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    useCuttingStore.getState().addBatch({
      subcategory: 'Palora Yellow', // a variety with no pre-existing inventory row
      cuttingType: 'Grafted with Roots',
      harvestDate: longAgo, dateSourced: longAgo, dateGrafted: '',
      quantitySourced: 20, sourceCostPerCutting: 40, graftCostPerCutting: 5,
      rootWeeks: 3, quantitySold: 0, notes: '',
    });

    const row = useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Palora Yellow');
    expect(row).toBeDefined();
    expect(row?.category).toBe(CUTTINGS_PRODUCT_TYPE);
    expect(row?.unit).toBe('piece');
    // Unit cost seeded from the batch's per-cutting cost (source + graft).
    expect(row?.unitCost).toBe(45);
    // Sellable pools are still zero at creation — packing credits availableForSale.
    expect(row?.packed ?? 0).toBe(0);
    expect(row?.availableForSale ?? 0).toBe(0);
    expect(row?.breedingStock ?? 0).toBe(0);
    // The matching sellable product is created too.
    expect(useProductStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Palora Yellow')).toBeDefined();
  });

  it('flagging For Replant keeps rooted-ready status and sets allocation', () => {
    const b = addRootedReadyBatch();
    useCuttingStore.getState().allocateBatch(b.id, CUTTING_ALLOCATION_REPLANT);
    const after = useCuttingStore.getState().getBatch(b.id)!;
    expect(after.allocation).toBe(CUTTING_ALLOCATION_REPLANT);
    expect(after.status).toBe(CUTTING_STATUS_ROOTED_READY);
    // Breeding stock pool credited.
    const row = useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White');
    expect(row?.breedingStock).toBe(20);
  });

  it('marking planted moves it out of breeding stock and flags planted', () => {
    const b = addRootedReadyBatch();
    useCuttingStore.getState().allocateBatch(b.id, CUTTING_ALLOCATION_REPLANT);
    useCuttingStore.getState().markPlanted(b.id);
    const after = useCuttingStore.getState().getBatch(b.id)!;
    expect(after.planted).toBe(true);
    expect(after.deploymentDate).toBeTruthy();
    const row = useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White');
    expect(row?.breedingStock).toBe(0);
  });

  it('reserving for farm credits breeding stock without planting (Option A)', () => {
    const b = addRootedReadyBatch();
    useCuttingStore.getState().allocateBatch(b.id, CUTTING_ALLOCATION_REPLANT);
    const after = useCuttingStore.getState().getBatch(b.id)!;
    // Reserved but NOT yet planted — breeding stock holds the reserved qty.
    expect(after.planted).toBeFalsy();
    expect(after.allocation).toBe(CUTTING_ALLOCATION_REPLANT);
    const row = useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White');
    expect(row?.breedingStock).toBe(20);
  });

  it('undo planted reverts to reserved and re-credits breeding stock', () => {
    const b = addRootedReadyBatch();
    useCuttingStore.getState().allocateBatch(b.id, CUTTING_ALLOCATION_REPLANT);
    useCuttingStore.getState().markPlanted(b.id);
    // Planted: breeding stock is emptied (moved to the field).
    let row = useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White');
    expect(row?.breedingStock).toBe(0);

    useCuttingStore.getState().unmarkPlanted(b.id);
    const after = useCuttingStore.getState().getBatch(b.id)!;
    expect(after.planted).toBe(false);
    expect(after.deploymentDate).toBe('');
    // Still reserved for the farm, and breeding stock is re-credited.
    expect(after.allocation).toBe(CUTTING_ALLOCATION_REPLANT);
    expect(after.status).toBe(CUTTING_STATUS_ROOTED_READY);
    row = useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White');
    expect(row?.breedingStock).toBe(20);
  });
});
