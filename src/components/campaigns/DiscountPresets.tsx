'use client';

/**
 * Aura Zľavy — PRESETY na obrazovke (D112, K7; KONTRAKT-V4-2026-08-28).
 *
 * Jeden komponent na dvoch miestach:
 *
 *   · na obrazovke Zľavy — zoznam presetov, použiť a zmazať,
 *   · vo formulári novej zľavy — to isté PLUS „uložiť aktuálne nastavenie",
 *     lebo len tam nejaké aktuálne nastavenie existuje (prop `draft`).
 *
 * ═══ KLIK NA PRESET NIE JE ZÁPIS (I3) — a je to napísané aj na obrazovke ═══
 *
 * „Použiť" je ODKAZ na `/zlavy/nova` s predplnenými poliami. Žiadne tlačidlo
 * tu nevolá `POST /api/campaigns`, `engine/executor` ani `setReduction`
 * a volať nebude: zľava sa aj z presetu zapíše až po skúške naprázdno
 * a potvrdení. Používateľ to musí VEDIEŤ, nie tušiť — preto je veta
 * `PRESET_NOTE` súčasťou panela a nie komentára v kóde.
 *
 * Prečo je to `<details>` a nie sekcia: obrazovka Zľavy má strop sekcií (P4,
 * P5) a preset je pomôcka, nie rozhodnutie. Panel je zatvorený, kým ho niekto
 * neotvorí, a nepýta si pozornosť pred dominantou obrazovky (P1).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Prázdny zoznam je tvrdenie.** Zlyhané čítanie sa hlási vetou, nie
 *     prázdnym panelom (I11) — inak by appka tvrdila „žiadne presety nemáš"
 *     práve vtedy, keď o nich nič nevie.
 *  2. **Pásmo bez čitateľného pravidla sa prizná.** Percento by inak pri
 *     predplnení sadlo na iné pásmo, než z ktorého bolo uložené.
 *  3. **Mazanie je dvojkrokové.** Nie preto, že by bolo nebezpečné (nič
 *     nezapisuje do shopu), ale preto, že preset sa nedá vrátiť späť jedným
 *     klikom a v zozname stoja tlačidlá vedľa seba.
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  createPreset,
  deletePreset,
  listPresets,
  markPresetUsed,
} from '@/components/campaigns/presets-api';
import {
  PRESET_NAME_MAX,
  PRESET_NOTE,
  presetDraftFrom,
  presetPercents,
  presetPrefillHref,
  presetSaveBlockedReason,
  presetSummarySk,
  type PresetView,
} from '@/components/campaigns/presets-model';
import styles from '@/components/campaigns/zlavy.module.css';
import type { TierPlan } from '@/components/campaigns/discounts-model';
import Button from '@/components/ui/Button';
import Note from '@/components/ui/Note';
import type { CatalogFilterState } from '@/components/products/catalog-filter';
import { formatDateSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

/** Čo sa dá uložiť ako preset — aktuálny stav formulára novej zľavy. */
export interface PresetDraftInput {
  readonly filter: CatalogFilterState;
  readonly tiers: readonly TierPlan[];
  readonly windowDays: number;
}

export interface DiscountPresetsProps {
  /**
   * Aktuálne nastavenie formulára. `null` = panel len ponúka a maže
   * (obrazovka Zľavy o žiadnom „aktuálnom nastavení" nevie).
   */
  readonly draft?: PresetDraftInput | null;
  /** Otvorený panel — používa formulár, kde je preset prvý krok. */
  readonly open?: boolean;
  readonly testId?: string;
}

/**
 * JEDEN RIADOK ZOZNAMU ako samostatný, vykresliteľný komponent.
 *
 * Oddelený z toho istého dôvodu ako `QueueTiles` a `DetailActions` v detaile
 * zľavy: `DiscountPresets` si presety ťahá až v efekte, takže
 * `renderToStaticMarkup` ho zastihne v stave „ešte nič neprišlo" a tvrdenie
 * „klik na preset je ODKAZ, nie zápis" by nemalo čo merať. Tu ho merať dá —
 * a je to to najdôležitejšie tvrdenie celého panela (I3).
 *
 * Komponent je čistý: žiadne hooky, žiadne načítavanie.
 */
export function PresetRow({
  preset,
  busy = false,
  confirming = false,
  onAskDelete,
  onDelete,
  onUse,
}: {
  readonly preset: PresetView;
  readonly busy?: boolean;
  /** `true` = riadok čaká na druhý klik mazania. */
  readonly confirming?: boolean;
  readonly onAskDelete?: (presetId: number) => void;
  readonly onDelete?: (presetId: number) => void;
  /**
   * „Siahol som po tomto presete" — beží PRI odkaze, nie namiesto neho.
   * Odkaz zostáva odkazom (I3); toto je jediný okamih, o ktorom appka vie, že
   * preset niekto použil.
   */
  readonly onUse?: (presetId: number) => void;
}) {
  const mapping = presetPercents(preset.tiers);
  return (
    <div className={styles.presetRow} data-testid={`preset-row-${preset.id}`}>
      <div className={styles.presetName}>
        <b>{preset.name}</b>
        <span className="lvl-3">{presetSummarySk(preset)}</span>
        <span className="lvl-3" data-testid={`preset-used-${preset.id}`}>
          {/*
           * I11 — „ešte nepoužitý" nie je dátum a nedopĺňa sa.
           *
           * Veta hovorí presne to, čo appka MERALA: `last_used_at` sa zapisuje
           * pri klike na „Predplniť formulár". Že z presetu naozaj vznikla
           * zľava, appka nevie a netvrdí — preset do zápisovej cesty
           * nevstupuje (I3).
           */}
          {preset.lastUsedAt === null
            ? 'ešte nepoužitý'
            : `naposledy predplnil formulár ${formatDateSk(preset.lastUsedAt.slice(0, 10))}`}
        </span>
        {mapping.unmappedTiers === 0 ? null : (
          <span className="lvl-3" data-testid={`preset-unmapped-${preset.id}`}>
            {formatCountSk(mapping.unmappedTiers)} z pásiem nemá čitateľné pravidlo — ich percento
            sa nepredplní
          </span>
        )}
      </div>
      <div className="row">
        {/*
         * ODKAZ, nie zápis: vedie na formulár novej zľavy s predplnenými
         * poľami. Skúška naprázdno a potvrdenie sa odohrajú tam, nanovo (I3).
         *
         * `onClick` na tom nič nemení — zapíše iba „naposledy predplnil
         * formulár" do lokálnej DB, aby zoznam ponúkol zhora ten, po ktorom
         * človek naozaj siaha. Nič sa tým nezapisuje do eshopu a odkaz sa
         * neprerušuje: navigácia beží ďalej aj keď ten zápis padne.
         */}
        <Link
          className="btn sm"
          href={presetPrefillHref(preset)}
          onClick={() => onUse?.(preset.id)}
          data-testid={`preset-use-${preset.id}`}
        >
          Predplniť formulár
        </Link>
        {confirming ? (
          <Button
            small
            variant="danger"
            disabled={busy}
            onClick={() => onDelete?.(preset.id)}
            data-testid={`preset-delete-confirm-${preset.id}`}
          >
            Naozaj zmazať
          </Button>
        ) : (
          <Button
            small
            variant="danger-quiet"
            disabled={busy}
            onClick={() => onAskDelete?.(preset.id)}
            data-testid={`preset-delete-${preset.id}`}
          >
            Zmazať
          </Button>
        )}
      </div>
    </div>
  );
}

export function DiscountPresets({
  draft = null,
  open = false,
  testId = 'discount-presets',
}: DiscountPresetsProps) {
  const [presets, setPresets] = useState<readonly PresetView[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Ktorý preset čaká na druhý klik mazania; `null` = žiadny. */
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await listPresets();
    if (res.ok) {
      setPresets(res.data);
      setFailed(null);
      return;
    }
    // Zlyhané čítanie NIE JE prázdny zoznam (bod 1 hlavičky).
    setPresets(null);
    setFailed(res.error.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveBlocked =
    draft === null
      ? 'Uložiť sa dá len z formulára novej zľavy.'
      : presetSaveBlockedReason({ name, tiers: draft.tiers, windowDays: draft.windowDays });

  const onSave = useCallback(async () => {
    if (draft === null) return;
    const body = presetDraftFrom({
      name,
      filter: draft.filter,
      tiers: draft.tiers,
      windowDays: draft.windowDays,
    });
    // Fail-closed: čo `presetDraftFrom` odmietlo, sa neposiela.
    if (body === null) return;
    setBusy(true);
    setSaveError(null);
    const res = await createPreset(body);
    setBusy(false);
    if (!res.ok) {
      setSaveError(res.error.message);
      return;
    }
    setName('');
    await load();
  }, [draft, name, load]);

  /**
   * Klik na „Predplniť formulár". Zápis JE fire-and-forget a je to zámer:
   * odkaz nesmie čakať na server ani sa dať zablokovať jeho zlyhaním. Keď
   * zápis nevyjde, riadok zostane „ešte nepoužitý" — teda pravda o tom, čo je
   * v DB (I11); vymyslený dátum by pravda nebol. Chybová veta sa nezobrazuje,
   * pretože človek už je medzitým na formulári a poradie v zozname nie je
   * niečo, čo by mal riešiť.
   */
  const onUse = useCallback((presetId: number) => {
    void markPresetUsed(presetId);
  }, []);

  const onDelete = useCallback(
    async (presetId: number) => {
      setBusy(true);
      setSaveError(null);
      const res = await deletePreset(presetId);
      setBusy(false);
      setConfirmDelete(null);
      if (!res.ok) {
        setSaveError(res.error.message);
        return;
      }
      await load();
    },
    [load],
  );

  const count = presets === null ? null : presets.length;

  return (
    <details className={styles.fold} open={open} data-testid={testId}>
      <summary>
        Presety — predplnia formulár novej zľavy
        {count === null ? '' : ` (${formatCountSk(count)})`}
      </summary>
      <div className={styles.foldBody}>
        {/* Čo preset ROBÍ a čo NEROBI. Jedna veta, jeden zdroj (K7). */}
        <div className="lvl-3" data-testid="presets-note">
          {PRESET_NOTE}
        </div>

        {failed === null ? null : (
          <Note variant="err" testId="presets-error">
            Presety sa nepodarilo načítať: {failed}
          </Note>
        )}
        {saveError === null ? null : (
          <Note variant="err" testId="presets-action-error">
            {saveError}
          </Note>
        )}

        {presets !== null && presets.length === 0 ? (
          <div className="lvl-3 gap-t" data-testid="presets-empty">
            Zatiaľ nie je uložený ani jeden preset.
          </div>
        ) : null}

        {presets === null || presets.length === 0 ? null : (
          <div className={styles.presetList}>
            {presets.map((preset) => (
              <PresetRow
                key={preset.id}
                preset={preset}
                busy={busy}
                confirming={confirmDelete === preset.id}
                onAskDelete={setConfirmDelete}
                onDelete={(presetId) => void onDelete(presetId)}
                onUse={onUse}
              />
            ))}
          </div>
        )}

        {draft === null ? null : (
          <div className={styles.presetSave} data-testid="preset-save-row">
            <input
              className="inp"
              value={name}
              maxLength={PRESET_NAME_MAX}
              placeholder="Meno presetu, napr. Ležiaky jeseň"
              onChange={(event) => setName(event.target.value)}
              aria-label="Meno nového presetu"
              data-testid="preset-name"
            />
            <Button
              small
              disabled={busy || saveBlocked !== null}
              {...(saveBlocked === null ? {} : { disabledReason: saveBlocked })}
              onClick={() => void onSave()}
              data-testid="preset-save"
            >
              Uložiť aktuálne nastavenie
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

export default DiscountPresets;
