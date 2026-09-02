/**
 * Aura Zľavy — KTORÉ ADRESY APPKA NAOZAJ OBSLUHUJE.
 *
 * PREČO TO EXISTUJE
 * -----------------
 * 27. 8. 2026 zmazalo D99 `SignOut.tsx` a rozcestník Nastavení mesiac ponúkal
 * odkaz na sekciu, ktorá neexistuje. Nenašiel to test, ale preklik —
 * `nastavenia-v12.spec.ts` si kotvu `odhlasenie` z kontroly identifikátorov
 * VÝSLOVNE vyňal s tým, že „kryje ju e2e", a e2e ju nekryla. Odvtedy platí:
 * odkaz, ktorý appka o sebe tvrdí, sa musí dať zmerať proti stromu `src/app`.
 *
 * PREČO JE TO POMOCNÍK A NIE FUNKCIA V SPEC SÚBORE
 * ------------------------------------------------
 * Meria to `omrvinky-nastaveni.spec.ts` (oddiel C: omrvinka a odkazy zo
 * sekcií) aj `nastavenia-rozcestnik.spec.ts` (oddiel E: štyri karty). Dve
 * kópie chôdze po strome by sa rozišli — a keď sa rozíde MERAČ, obe merania
 * zostanú zelené a nikto nezistí, ktoré z nich klame. Repo to má zapísané ako
 * pravidlo: to isté nesmie žiť na dvoch miestach.
 *
 * ČO TO NEMERIA
 * -------------
 * Či na cieľovej stránke niekto kreslí sekciu s tou kotvou. Routa môže
 * existovať a odkaz aj tak skončí v prázdne — presne to sa stalo kotve
 * `odhlasenie`. Tú druhú polovicu meria `omrvinky-nastaveni.spec.ts` na
 * vykreslenom markupe sekcií a je to zámerne inde: tento súbor pozná len
 * adresy, nie obsah.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Cesty, ktoré appka naozaj obsluhuje — odvodené zo stromu `src/app`. */
function najdiRouty(): readonly string[] {
  const koren = resolve(process.cwd(), 'src/app');
  const out: string[] = [];
  const chod = (dir: string, useky: readonly string[]) => {
    for (const zapis of readdirSync(dir, { withFileTypes: true })) {
      if (zapis.isDirectory()) {
        // Zoskupenie `(nazov)` Next z adresy vypúšťa, do cesty teda nepatrí.
        const dalsie = /^\(.+\)$/.test(zapis.name) ? useky : [...useky, zapis.name];
        chod(join(dir, zapis.name), dalsie);
      } else if (zapis.name === 'page.tsx' || zapis.name === 'route.ts') {
        out.push(`/${useky.join('/')}`);
      }
    }
  };
  chod(koren, []);
  return out;
}

/** Zoznam adries. Čítaný raz — chôdza po strome je to najdrahšie tu. */
export const APP_ROUTY: readonly string[] = najdiRouty();

/**
 * Obsluhuje appka túto adresu? Kotva aj dopyt sa odstrihnú, dynamický úsek
 * `[id]` prijme čokoľvek neprázdne.
 */
export function routaExistuje(href: string): boolean {
  const cesta = href.split('#')[0]!.split('?')[0]!;
  const chcem = (cesta === '' ? '/' : cesta).split('/');
  return APP_ROUTY.some((routa) => {
    const mam = routa.split('/');
    if (mam.length !== chcem.length) return false;
    return mam.every((usek, i) => (/^\[.+\]$/.test(usek) ? chcem[i] !== '' : usek === chcem[i]));
  });
}

/** Vnútorné odkazy z markupu. Vonkajšie (`https:`, `mailto:`) sa netýkajú. */
export function odkazyZMarkupu(markup: string): readonly string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1]!)
    .filter((href) => href.startsWith('/'));
}
