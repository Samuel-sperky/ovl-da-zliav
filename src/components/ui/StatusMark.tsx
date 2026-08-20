/**
 * Aura Zľavy — ZNAČKA STAVU JE IKONA, NIE ZNAK V CSS.
 *
 * Tento súbor je dokončením vlny „bez emoji" (19. 8. 2026). Rodina tried
 * `.sig`, `.flag` a `.state` v `globals.css` kreslila druhý kanál stavu cez
 * `content:` v pseudo-prvku `::before` — teda znakmi `✓ ▲ ✕ ◆ ○ ● ·`.
 *
 * PREČO TO MUSELO SKONČIŤ
 * -----------------------
 *
 * 1. **Pseudo-prvok nevie nakresliť ťah.** Ani jeden z tých znakov nie je v
 *    písme Inter, ktoré appka dodáva (`test/unit/typografia.spec.ts`); všetky
 *    padali do systémového symbolového zásobníka, takže sa kreslili iným
 *    písmom, s inou hrúbkou a na každom operačnom systéme inak. Zmeraná
 *    typografia sa ich vôbec netýkala.
 * 2. **Zámok si kvôli tomu vyrobil DRUHÚ kópiu cesty.** `🔒` bolo farebné, a
 *    tak zámok v `.sig.lock::before` prešiel na CSS masku — s cestou ikony
 *    `lock` zapečenou do `url("data:image/svg+xml,…")`. Cesta ikony tým bola v
 *    repe dvakrát: raz v `Icon.tsx`, raz v CSS. Bola to jediná taká duplicita
 *    a pri zmene tvaru by sa ticho rozišla.
 * 3. **Rodina `.sig` nebola pravdivá o sebe.** `.sig` je `inline-flex` s
 *    `gap`, teda kontejner pre dve deti — ale druhé dieťa nemala, len
 *    pseudo-prvok, ktorý sa nedá adresovať, testovať ani skryť pre čítačku
 *    inak než globálne.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Značka je TRETÍ kanál, nikdy prvý.** Pravidlo appky znie „stav nie je
 *     nikdy len farba — vždy farba + značka + slovo" a je zmerané: pod
 *     deuteranopiou nesie rozdiel susedných tónov len jas, takže SLOVO je
 *     jediný spoľahlivý kanál. Kto tu nahradí slovo ikonou, zoberie
 *     používateľovi ten jediný kanál, na ktorý sa dá spoľahnúť.
 *  B. **Tieto komponenty kreslia LEN ikonu, nič viac.** Nedávajú si vlastný
 *     `<span>`, vlastnú triedu ani vlastnú farbu. Je to zámer: hostiteľský
 *     prvok (`<span className="sig ok">`, `<p className="flag">`) zostáva
 *     presne taký, aký bol — s tou istou triedou, tým istým `data-testid` a
 *     tým istým typom prvku. Vďaka tomu prechod na ikony NEZMENIL ani jedno
 *     tvrdenie o farbe (`test/unit/paleta.spec.ts` číta `.sig.*` a `.state.*`
 *     ďalej) a `toneSigClass()` naďalej vracia meno triedy.
 *  C. **Farba sa dedí.** `Icon` má `stroke="currentColor"`; farbu nesie trieda
 *     hostiteľa. Kto sem pridá `color`, obíde zmeranú paletu zadnými dverami.
 *  D. **`aria-hidden` je predvolené a správne.** Pri každej z týchto značiek
 *     stojí slovo v tom istom DOM uzle, takže `role="img"` by čítačke prečítal
 *     ten istý stav dvakrát.
 *  E. **Mapy nižšie sú jednosmerné okná do už existujúcich slovníkov.**
 *     `SIG_ICON` prekladá HISTORICKÉ mená tried (`ok`, `warn`, `bad`) na ikonu;
 *     kanonický prevod `tón → ikona` žije v `TONE_ICON` (`ui/ToneBadge.tsx`) a
 *     `resolutionLook()` (`ui/blocker-look.ts`). Kto by si napísal tretiu mapu
 *     stavov, otvorí presne tú chybu, ktorú `ui/blocker-look.ts` opisuje v
 *     hlavičke.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ (a ako to zbadať)
 * ---------------------------------------------
 *
 *  • Keby niekto pridal do `globals.css` nový `.sig.<niečo>::before` s
 *    `content:`, vrátil by sa znak vedľa ikony a stav by mal značku dvakrát.
 *    Na obrazovke to vyzerá ako preklep, nie ako chyba — preto to stráži
 *    `test/unit/ikony.spec.ts`, nie oko.
 *  • Keby niekto pridal ďalšie miesto s triedou `.sig …` a zabudol na
 *    `<SigMark>`, stav tam ostane bez značky. Farba a slovo tam budú, takže
 *    nič nespadne. Ten istý test preto počíta miesta s triedou a miesta so
 *    značkou proti sebe.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: W1, šprint dokončenia 19. 8. 2026.
 */
import Icon, { type IconName } from '@/components/ui/Icon';
import { TONE_ICON, type StatusTone } from '@/components/ui/ToneBadge';
import type { FlagTone, StateTone } from '@/lib/ui/vocabulary';

/**
 * Varianty triedy `.sig` z `globals.css`.
 *
 * Sú to mená TRIED, nie šiesty a siedmy stav appky: `ok`/`warn`/`bad` sú
 * historické mená nad tou istou päticou `--st-*`, ktorú vystavuje `StatusTone`
 * (`ui/ToneBadge.tsx`). `lock` medzi nimi zostáva pre trvalé obmedzenie, ktoré
 * appka vedome NEsignalizuje ako závažnosť — prekážke sa priradiť nesmie
 * (pozri bod 4 hlavičky `ui/blocker-look.ts`).
 */
export type SigVariant = 'ok' | 'warn' | 'bad' | 'progress' | 'idle' | 'lock';

/**
 * Variant `.sig` → ikona. Tvary sedia na to, čo tu do 19. 8. 2026 kreslilo CSS
 * (`✓ ▲ ✕ ◆ ○`), aby sa významy prechodom na ikony neposunuli.
 */
export const SIG_ICON: Readonly<Record<SigVariant, IconName>> = {
  ok: 'check',
  warn: 'alertTriangle',
  bad: 'x',
  progress: 'loader',
  idle: 'circle',
  lock: 'lock',
};

/**
 * Značka do hostiteľa s triedou `.sig …`.
 *
 * `0.85 em` je prepočet pôvodných 10 px šírky slotu `.sig::before` na písmo
 * `.sig` (11,5 px) — značka odteraz rastie a klesá s textom, pri ktorom stojí.
 */
export function SigMark({ variant }: { variant: SigVariant }) {
  return <Icon name={SIG_ICON[variant]} size={0.85} />;
}

/**
 * To isté, ale vstupom je TÓN (`StatusTone`), nie meno triedy.
 *
 * Existuje kvôli miestam, ktoré si triedu skladajú cez `toneSigClass()` —
 * tie počítajú v tónoch a prevod na historické `ok`/`warn`/`bad` by tu bol
 * druhý slovník. Ikonu preto berie rovno z `TONE_ICON` (`ui/ToneBadge.tsx`),
 * teda z toho istého koreňového slovníka značiek, aký kreslí badge.
 */
export function ToneSigMark({ tone }: { tone: StatusTone }) {
  return <Icon name={TONE_ICON[tone]} size={0.85} />;
}

/**
 * Tón príznaku → ikona.
 *
 * Príznak (`.flag`) stojí VŽDY za stavom a nikdy nie je stav — zľava so
 * zlyhanými položkami stále beží. Preto je `neutral` prázdny krúžok a nie
 * fajka: príznak nič nekvituje, len upozorňuje.
 */
export const FLAG_ICON: Readonly<Record<FlagTone, IconName>> = {
  good: 'check',
  neutral: 'circle',
  attention: 'alertTriangle',
  critical: 'x',
};

/** Značka do hostiteľa s triedou `.flag` (aj `.flag.neutral`). */
export function FlagMark({ tone = 'attention' }: { tone?: FlagTone }) {
  return <Icon name={FLAG_ICON[tone]} size={0.8} />;
}

/**
 * Tón stavu zľavy → ikona.
 *
 * `done` je fajka zámerne: „skončila" znamená, že zľava dobehla svoj čas, a
 * dôvody, prečo to nedopadlo dobre, nesú PRÍZNAKY vedľa stavu (`.flag`), nie
 * stav sám. Predtým tu bola `·`, ktorá je od `—` („toto nevieme") na oko
 * nerozoznateľná — jeden znak niesol dva úplne rozdielne významy.
 */
export const STATE_ICON: Readonly<Record<StateTone, IconName>> = {
  idle: 'circle',
  progress: 'loader',
  live: 'circleDot',
  done: 'check',
};

/** Značka do hostiteľa s triedou `.state …`. */
export function StateMark({ tone }: { tone: StateTone }) {
  return <Icon name={STATE_ICON[tone]} size={0.85} />;
}
