/**
 * Aura Zľavy — typy, ktoré si kroky ticku podávajú medzi sebou
 * (KONTRAKT V3: K2, K5).
 *
 * Prečo tento súbor vôbec vznikol: `src/contracts.ts` (vlastník A0) stav
 * `queued` ani príznak `late` nepozná, takže `CampaignRecordV3` z
 * `lib/repo/campaigns.repo.ts` **nie je** podtypom `CampaignRecord` — union
 * stavov je širší. Keby scheduler ďalej pracoval s `CampaignRecord`, produkčný
 * repozitár by sa doň dal dostať jedine pretypovaním. A práve pretypovanie na
 * nekompatibilnú signatúru je nález E1: scheduler bol „zapojený", kompiloval sa
 * a NIKDY nič nezapísal.
 *
 * Preto tu žije `SchedulerCampaign` — najmenší tvar, ktorý naraz prijme
 * `CampaignRecord` (starý kontrakt) aj `CampaignRecordV3` (fronta V3), bez
 * jediného `as`:
 *   - `status` je širší union (`+ 'queued'`), takže sa doň zmestí oboje,
 *   - `late` je VOLITEĽNÉ, takže starý tvar bez tohto stĺpca stále pasuje.
 *
 * Metódy repozitára sú zámerne deklarované ako **metódy**, nie ako vlastnosti
 * typu funkcie: pri metódach je TypeScript v parametroch bivariantný, takže
 * in-memory fake z testov (`allowedFrom: CampaignStatus[]`) aj produkčný
 * repozitár (`allowedFrom: CampaignStatusV3[]`) sedia do toho istého rozhrania.
 *
 * Vlastník: V7.
 */
import type { CampaignRecord, DateOnly, UtcDate } from '@/contracts';
import type { CampaignStatusV3 } from '@/lib/repo/campaigns.repo';

export type { CampaignStatusV3 };

/**
 * Kampaň, ako ju vidí scheduler. Zhodný trik ako `ExecutorCampaign` v
 * `engine/executor.ts` — jeden tvar pre starý kontrakt aj pre frontu V3.
 */
export type SchedulerCampaign = Omit<CampaignRecord, 'status'> & {
  status: CampaignStatusV3;
  /** K5 — fronta nedobehla do `date_from`. Fakt o čase, nie chyba. */
  late?: boolean;
};

/**
 * Patch, ktorý scheduler posiela do `setStatus()`. `date_to` tu ZÁMERNE nie je
 * a nikdy nebude: skrátenie okna je tvar rušenia zľavy (I7, K5).
 */
export type SchedulerCampaignPatch = Partial<
  Pick<
    CampaignRecord,
    | 'statusReason'
    | 'needsKeySince'
    | 'startedAt'
    | 'finishedAt'
    | 'itemsTotal'
    | 'itemsOk'
    | 'itemsFailed'
    | 'itemsUncertain'
    | 'resultAckAt'
    | 'dateFrom'
    | 'dateFromOriginal'
  >
> & { late?: boolean };

/**
 * Časť repozitára kampaní, ktorú scheduler používa. Produkčný
 * `campaignsRepoV3` ju spĺňa bez pretypovania — to je celý účel.
 */
export interface SchedulerCampaignsRepo {
  /** D32: `scheduled` kampane s `fire_at <= now`. */
  findDue(now: UtcDate): Promise<SchedulerCampaign[]>;
  /** D26: VŠETKY `scheduled` bez dátumovej podmienky (sentinel dátum by MariaDB skrátila). */
  findScheduled(): Promise<SchedulerCampaign[]>;
  findMissedCandidates(threshold: UtcDate): Promise<SchedulerCampaign[]>;
  findNeedsKey(): Promise<SchedulerCampaign[]>;
  findRunningUnfinished(): Promise<SchedulerCampaign[]>;
  /** K2: vstup do fronty — najskorší `date_from` prvý. */
  findQueued(limit?: number): Promise<SchedulerCampaign[]>;
  /** K5: kampane, ktorým už nabehlo okno a stále majú `pending` položky. */
  findLateCandidates(today: DateOnly): Promise<SchedulerCampaign[]>;
  /** K5: `true` = príznak sa práve teraz zmenil z 0 na 1. */
  markLate(id: number): Promise<boolean>;
  /** D84: atomický claim, pokračuje sa len pri `affectedRows = 1`. */
  claim(id: number, allowedFrom: CampaignStatusV3[]): Promise<boolean>;
  setStatus(
    id: number,
    status: CampaignStatusV3,
    patch?: SchedulerCampaignPatch,
  ): Promise<void>;
}
