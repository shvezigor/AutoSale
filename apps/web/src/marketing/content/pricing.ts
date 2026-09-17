import type { LocalizedValue } from './types';

export type PricingPlan = {
  id: 'start' | 'growth' | 'scale';
  monthlyUah: number;
  orders: number;
  channels: string;
  users: number;
  products: number;
  name: string;
  summary: LocalizedValue<string>;
  featured?: boolean;
};

export const annualDiscount = 0.2;

export const pricingPlans: PricingPlan[] = [
  { id: 'start', name: 'Start', monthlyUah: 599, orders: 300, channels: '1', users: 3, products: 2000, summary: { uk: 'Для старту системних продажів в одному каналі.', en: 'For building a reliable sales process in one channel.' } },
  { id: 'growth', name: 'Growth', monthlyUah: 1999, orders: 1500, channels: '3', users: 10, products: 10000, featured: true, summary: { uk: 'Для команди, що масштабує щоденний потік замовлень.', en: 'For a team scaling its daily order flow.' } },
  { id: 'scale', name: 'Scale', monthlyUah: 2999, orders: 5000, channels: 'all', users: 25, products: 50000, summary: { uk: 'Для великих обсягів і майбутньої омніканальності.', en: 'For high volume and future omnichannel operations.' } },
];

export function annualPrice(monthlyUah: number): number {
  return Math.round(monthlyUah * 12 * (1 - annualDiscount));
}
