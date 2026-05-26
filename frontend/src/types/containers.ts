/* Shared types for the Consumer Containers feature.
 * See CONTAINERS_FEATURE_SPEC.md for lifecycle and decisions. */

export type ContainerType = '2.8L' | '5L';

export type HoldingStatus =
  | 'pending_delivery'
  | 'held'
  | 'refund_requested'
  | 'refunded'
  | 'forfeited';

export type RefundDestination = 'manual' | 'store_credit';

export interface ContainerHolding {
  id: number;
  consumer_id: number;
  invoice_id: number;
  order_item_id: number | null;
  original_product_id: number;
  current_product_id: number;
  container_type: ContainerType;
  deposit_amount: number;
  status: HoldingStatus;
  refund_destination: RefundDestination | null;
  requested_at: string | null;
  resolved_at: string | null;
  resolved_by: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContainerSwap {
  id: number;
  holding_id: number;
  from_product_id: number;
  to_product_id: number;
  diff_amount: number;
  diff_payment_id: string | null;
  triggered_in: 'checkout' | 'containers_page' | 'product_page';
  created_at: string;
}

export interface StoreCreditEntry {
  id: number;
  consumer_id: number;
  delta: number;
  reason: string;
  source_type: string | null;
  source_id: number | null;
  created_by: number | null;
  created_at: string;
}
