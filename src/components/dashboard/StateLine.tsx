/**
 * Aura Zľavy — stav zľavy a jeho príznaky ako jeden riadok (Prehľad).
 *
 * TENTO SÚBOR UŽ NIČ NEKRESLÍ — je to len druhé meno pre `DiscountState`.
 *
 * PREČO
 * -----
 * Do 19. 8. 2026 tu stála doslovná kópia `campaigns/DiscountState.tsx`: tá istá
 * tabuľka `STATE_CLASS`, tá istá funkcia `flagClass`, to isté značkovanie.
 * Líšili sa jediným — z ktorého CSS modulu si berú `flagCritical` — a obe
 * pravidlá boli `color: var(--st-critical)`, teda tá istá farba napísaná
 * dvakrát. Bola to druhá kópia slovníka stavov zľavy, ktorá čakala, kedy sa
 * rozíde s prvou. Presne to sa už raz stalo prekážkam (tri prevodníky
 * `resolution → farba`, tri obrazovky, tri rôzne odpovede) a stálo to tri
 * samostatné chyby.
 *
 * Meno `StateLine` zostáva, aby `StatusSection.tsx` a `CampaignsSection.tsx`
 * nemuseli meniť import. Kto sem vráti telo komponentu, obnoví tú kópiu.
 *
 * Slovník appky hovorí „zľava", nikdy „kampaň" — implementácia preto žije pod
 * menom `DiscountState`.
 */
export {
  DiscountState as StateLine,
  default,
  type DiscountStateProps as StateLineProps,
} from '@/components/campaigns/DiscountState';
