import React from 'react';
import ChakraIcon from './ChakraIcon';
import { LUCKY_DRAW_ORDER_LABEL, type LuckyDrawOrderKind } from '../../config/luckyDraw';

/**
 * Marks an order as one of the lucky draw's free deliveries.
 *
 * These look like any other ₹0 order in a list, and a trader or delivery agent
 * seeing one needs to know immediately that there is nothing to collect and
 * why. Gold, because that is the feature's colour everywhere else it appears.
 */
export default function LuckyDrawOrderBadge({
  kind,
  size = 'md',
}: {
  kind: LuckyDrawOrderKind;
  size?: 'sm' | 'md';
}) {
  const small = size === 'sm';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${
        small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      }`}
      style={{ backgroundColor: '#f8edcc', color: '#6a4219' }}
    >
      <ChakraIcon size={small ? 11 : 13} className="flex-shrink-0" />
      {LUCKY_DRAW_ORDER_LABEL[kind]}
    </span>
  );
}
