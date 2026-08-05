/**
 * Aura Zľavy — verejné rozhranie grafov (plán §6, sekcia B2).
 *
 * Čo sľubuje plán §6 a čo teda ostatní agenti smú importovať bez zmeny:
 *   `<CampaignTimeline/>` (G1) · `<DiscountDepth/>` (G2) · `<AuditActivity/>` (G4)
 *
 * Nad rámec §6 sú tu ešte tri kusy, ktoré §4 vyžaduje a §6 ich menovite
 * neuviedol — sú dostupné rovnako a majú stabilné props:
 *   `<ProductWriteHistory productId/>` (G3, detail produktu)
 *   `<CampaignItemsBar tally|campaignId/>` (G5, detail kampane)
 *   `<KeyTtlArc secondsLeft/>` (G6, hlavička/dashboard — dáta má hostiteľ)
 *
 * Všetky grafy vedia bežať v dvoch režimoch: s dodanými `data`/`tally`
 * (server render, testy) alebo bez nich, kedy si sami načítajú
 * `GET /api/insights/*`. Žiadny z nich nič nezapisuje.
 */
export { default as CampaignTimeline } from '@/components/charts/CampaignTimeline';
export { default as DiscountDepth } from '@/components/charts/DiscountDepth';
export { default as DiscountMiniBar } from '@/components/charts/DiscountMiniBar';
export { default as ProductWriteHistory } from '@/components/charts/ProductWriteHistory';
export { default as AuditActivity } from '@/components/charts/AuditActivity';
export { default as CampaignItemsBar } from '@/components/charts/CampaignItemsBar';
export { default as KeyTtlArc } from '@/components/charts/KeyTtlArc';

export type { CampaignTimelineProps } from '@/components/charts/CampaignTimeline';
export type { DiscountDepthProps } from '@/components/charts/DiscountDepth';
export type { DiscountMiniBarProps } from '@/components/charts/DiscountMiniBar';
export type { ProductWriteHistoryProps } from '@/components/charts/ProductWriteHistory';
export type { AuditActivityProps } from '@/components/charts/AuditActivity';
export type { CampaignItemsBarProps } from '@/components/charts/CampaignItemsBar';
export type { KeyTtlArcProps } from '@/components/charts/KeyTtlArc';
