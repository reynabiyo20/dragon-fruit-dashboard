/**
 * useWholesaleForecast — assembles the wholesale supply forecast from deployed
 * cuttings across two sources:
 *   1. Internal batches marked Planted (deploymentDate set).
 *   2. Customer/partner cutting sales marked Delivered (deliveredDate as deploy).
 *
 * It maps each deployment to its projected harvest window and aggregates the
 * pieces + kilograms into Internal vs Partner pools per window.
 */
import { useMemo } from 'react';
import { format } from 'date-fns';
import { useCuttingStore } from '../store/cuttingStore';
import { useSaleStore } from '../store/saleStore';
import { useProductStore } from '../store/productStore';
import { useFarmStore } from '../store/farmStore';
import { useAssumptionsStore } from '../store/assumptionsStore';
import {
  buildForecast, forecastTotals, type Deployment, type ForecastWindow,
} from '../utils/forecast';
import {
  CUTTINGS_PRODUCT_TYPE, CUTTING_TYPE_GRAFTED, CUTTING_ALLOCATION_REPLANT,
} from '../constants';

export interface WholesaleForecast {
  windows: ForecastWindow[];
  totals: ReturnType<typeof forecastTotals>;
  deploymentCount: number;
}

export function useWholesaleForecast(): WholesaleForecast {
  const batches = useCuttingStore((s) => s.batches);
  const sales = useSaleStore((s) => s.sales);
  const products = useProductStore((s) => s.products);
  const plantings = useFarmStore((s) => s.plantings);
  const assumptions = useAssumptionsStore((s) => s.values);

  return useMemo(() => {
    const deployments: Deployment[] = [];

    // Batches that have GRADUATED into standing plants (a planting carries their
    // sourceBatchId) are represented by the FARM pool below — exclude them from
    // the internal pool so they're never double-counted.
    const graduatedBatchIds = new Set(
      plantings.map((p) => p.sourceBatchId).filter((id): id is string => !!id),
    );

    // 1. Internal batches deployed into the field. Only standing FIELD plants
    //    produce fruit, so an internal batch counts ONLY when it is BOTH:
    //      - flagged "For Replant in Farm" (not a sales/"For Delivery" batch), and
    //      - marked Planted (deployed into the ground via Mark as Planted).
    //    Batches meant to be packed & sold as cuttings ("For Delivery") never
    //    yield farm fruit and are excluded entirely.
    batches.forEach((b) => {
      const isReplant = b.allocation === CUTTING_ALLOCATION_REPLANT;
      if (!isReplant || !b.planted || !b.deploymentDate) return;
      if (graduatedBatchIds.has(b.id)) return; // now a standing planting (farm pool)
      deployments.push({
        pool: 'internal',
        cuttingType: b.cuttingType ?? CUTTING_TYPE_GRAFTED,
        quantity: b.quantityAvailable,
        deploymentDate: b.deploymentDate,
        variety: b.subcategory,
        label: `Internal batch · ${b.subcategory}`,
      });
    });

    // 2. Delivered customer/partner cutting sales — each cutting line becomes a
    //    partner deployment dated on the delivery date (falling back to the sale
    //    date if a legacy delivered sale carries no deliveredDate).
    sales.forEach((s) => {
      if (!s.delivered) return;
      const deployedOn = s.deliveredDate || s.date;
      s.items.forEach((item) => {
        if (!item.productId) return;
        const product = products.find((p) => p.id === item.productId);
        if (!product || product.category !== CUTTINGS_PRODUCT_TYPE) return;
        deployments.push({
          pool: 'partner',
          // Cuttings sold to partners are grafted/rooted stock.
          cuttingType: CUTTING_TYPE_GRAFTED,
          quantity: Number(item.quantity) || 0,
          deploymentDate: deployedOn,
          variety: product.subcategory,
          label: `${s.customerName || 'Partner'} · ${product.subcategory}`,
        });
      });
    });

    // 3. Standing FARM plants (existing orchard). Each planting projects fruit:
    //    - Mature/established plants (matureFruiting) produce NOW → deploy "today"
    //      so the engine projects the next in-season window, at the per-mature-
    //      plant seasonal yield.
    //    - Young plantings with a plantedDate project their FIRST harvest from
    //      that date via the normal cutting-type timeline + first-harvest yield.
    const today = format(new Date(), 'yyyy-MM-dd');
    plantings.forEach((p) => {
      const qty = Number(p.plantCount) || 0;
      if (qty <= 0) return;
      const isMature = !!p.matureFruiting;
      deployments.push({
        pool: 'farm',
        cuttingType: p.cuttingType ?? CUTTING_TYPE_GRAFTED,
        quantity: qty,
        deploymentDate: isMature ? today : (p.plantedDate || today),
        variety: p.subcategory,
        label: `Farm plants · ${p.subcategory}`,
        // Mature plants yield the per-mature-plant seasonal figure; young ones
        // use the cutting first-harvest yield (fruitsPerUnit left undefined).
        ...(isMature ? { fruitsPerUnit: assumptions.yieldFruitsPerMaturePlant } : {}),
      });
    });

    const forecastInputs = {
      fruitWeightKg: assumptions.fruitWeightKg,
      yieldFruitsGrafted: assumptions.yieldFruitsGrafted,
      yieldFruitsUnrooted: assumptions.yieldFruitsUnrooted,
      harvestDaysGrafted: assumptions.harvestDaysGrafted,
      harvestDaysUnrooted: assumptions.harvestDaysUnrooted,
    };
    const windows = buildForecast(deployments, forecastInputs);
    return {
      windows,
      totals: forecastTotals(windows),
      deploymentCount: deployments.length,
    };
  }, [batches, sales, products, plantings, assumptions]);
}
