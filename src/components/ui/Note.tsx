/**
 * Aura Zľavy — VYSVETLIVKA PRI MIESTE VÝSKYTU (predloha `sperky-admin.html`,
 * `.note` / `.note.warn` / `.note.err`).
 *
 * Krátky text s farebným ľavým prúžkom, ktorý stojí TAM, kde vec platí — nie
 * v pätke stránky a nie v nápovede. Predloha ho používala presne takto:
 * upozornenie o CORS pri poli s adresou, poznámka o scope pri filtroch.
 *
 * VZŤAH K `ErrorMessage`
 * ----------------------
 * `ErrorMessage` je ŤAŽKÁ verzia toho istého panela: vie rozbaľovací technický
 * detail a redigovanú raw odpoveď z API (D15, §8). `Note` je ľahká: len veta.
 * Obidva kreslia `.ovl-note` z `globals.css`, takže vyzerajú ako jedna vec —
 * a `Note` zámerne NEZAVÁDZA vlastné triedy. Keď máš kód chyby alebo raw
 * odpoveď, siahni po `ErrorMessage`; keď len vysvetľuješ, po `Note`.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Prúžok vľavo nie je jediný nosič.** Vysvetlivka nesie aj glyf
 *    (`○ ▲ ✕`) — farebný prúžok sám je v tmavej téme pri `warn` a `err`
 *    zameniteľný.
 * 2. **`err` prerušuje, ostatné počkajú.** `role="alert"` len pre `err`
 *    (`noteRole`). Keby ho mala aj `info`, čítačka by skákala do reči pri
 *    každej vysvetlivke na obrazovke.
 * 3. **Vysvetlivka nie je nadpis.** Deti sú TEXT, nie karta ani tabuľka.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1.
 */
import type { ReactNode } from 'react';

import { NOTE_CLASS, NOTE_GLYPH, noteRole, type NoteVariant } from '@/components/ui/primitives';

export type { NoteVariant };

export interface NoteProps {
  /**
   * `info` — vysvetlenie a kontext, `warn` — pozor, niečo sa nemusí podariť,
   * `err` — nepodarilo sa. Predvolene `info`.
   */
  variant?: NoteVariant;
  /** Text vysvetlivky. */
  children: ReactNode;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function Note({ variant = 'info', children, testId }: NoteProps) {
  return (
    <div
      className={NOTE_CLASS[variant]}
      role={noteRole(variant)}
      data-variant={variant}
      data-testid={testId}
    >
      <span className="ovl-note-glyph" aria-hidden="true">
        {NOTE_GLYPH[variant]}
      </span>
      <span>{children}</span>
    </div>
  );
}

export default Note;
