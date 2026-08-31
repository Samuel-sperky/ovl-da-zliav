'use client';

/**
 * Aura Zľavy — ČÍTANIE A SPRÁVA PRESETOV zo strany prehliadača (D112, K7).
 *
 * Tri volania, presne tie tri, ktoré server má (`src/app/api/presets`):
 * zoznam, uloženie, zmazanie. **Volanie „spusť preset" tu nie je a nesmie
 * vzniknúť** — preset predplní formulár a zľava sa aj z neho zapíše až po
 * skúške naprázdno a potvrdení (I3). Zdôvodnenie je v `presets-model.ts`
 * a na serveri v `presets/_shared.ts`.
 *
 * Odpoveď sa ČÍTA, nie pretypúva: `Envelope<T>` sa overuje len po obálku,
 * takže `getJson<PresetView[]>` by bol `as` bez kontroly. Nečitateľný riadok sa
 * zahodí, nečitateľné TELO je chyba obálky — prázdny zoznam je tvrdenie „žiadny
 * preset neexistuje" a to pri nečitateľnej odpovedi nikto nevie (I11).
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import { delJson, getJson, postJson, type Envelope } from '@/components/campaigns/api';
import type { PresetDraft, PresetTierView, PresetView } from '@/components/campaigns/presets-model';
import { asRecord, readCount, readText } from '@/components/dashboard/json';

/** Jedno pásmo presetu, alebo `null` keď sa nedá ani zobraziť. */
export function parsePresetTier(raw: unknown): PresetTierView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const ord = readCount(record, 'ord');
  const percent = readCount(record, 'percent');
  if (ord === null || percent === null) return null;
  return {
    ord,
    label: readText(record, 'label') ?? '',
    percent,
    // `rule` sa preberá tak, ako prišlo — prekladá ho `tierRuleOf()`.
    ...(record['rule'] === undefined ? {} : { rule: record['rule'] }),
  };
}

/**
 * Jeden preset, alebo `null`.
 *
 * Hranica je `id` a `name`: bez identity sa nedá zmazať a bez mena sa nedá
 * ponúknuť. `lastUsedAt` zostáva `null`, keď ho server neposlal — pomlčku si
 * domyslí obrazovka, appka si tu nepodstrčí `createdAt` (I11).
 */
export function parsePreset(raw: unknown): PresetView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = readCount(record, 'id');
  const name = readText(record, 'name');
  if (id === null || name === null) return null;
  const tiers = record['tiers'];
  return {
    id,
    name,
    filterQuery: readText(record, 'filterQuery') ?? '',
    tiers: Array.isArray(tiers)
      ? tiers.map(parsePresetTier).filter((tier): tier is PresetTierView => tier !== null)
      : [],
    durationDays: readCount(record, 'durationDays') ?? 0,
    createdAt: readText(record, 'createdAt') ?? '',
    lastUsedAt: readText(record, 'lastUsedAt'),
  };
}

/** Zoznam presetov, alebo `null` keď telo nie je pole (teda sa neprečítalo). */
export function parsePresetList(raw: unknown): PresetView[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map(parsePreset).filter((preset): preset is PresetView => preset !== null);
}

const unreadable = <T,>(): Envelope<T> => ({
  ok: false,
  error: {
    code: 'unreadable_body',
    message: 'Presety sa nepodarilo prečítať. Skúste obrazovku obnoviť.',
  },
});

export async function listPresets(): Promise<Envelope<readonly PresetView[]>> {
  const res = await getJson<unknown>('/api/presets');
  if (!res.ok) return res;
  const list = parsePresetList(res.data);
  return list === null ? unreadable<readonly PresetView[]>() : { ok: true, data: list };
}

export async function createPreset(draft: PresetDraft): Promise<Envelope<PresetView>> {
  const res = await postJson<unknown>('/api/presets', draft);
  if (!res.ok) return res;
  const preset = parsePreset(res.data);
  return preset === null ? unreadable<PresetView>() : { ok: true, data: preset };
}

/**
 * Zmazanie presetu. Neexistujúci preset je na serveri 404 `preset_not_found` —
 * „zmazal som nič" sa nesmie javiť ako „zmazal som to, čo si chcel".
 */
export function deletePreset(presetId: number): Promise<Envelope<unknown>> {
  return delJson<unknown>(`/api/presets/${presetId}`);
}
