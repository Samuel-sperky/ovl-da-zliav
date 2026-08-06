/**
 * Aura Zľavy — gating stránok (Next.js middleware, A4/A16, D69, D72).
 *
 * PROBLÉM, KTORÝ TENTO SÚBOR RIEŠI
 * --------------------------------
 * Do 6.8.2026 appka nemala žiadnu bránu pred renderom stránok. Neprihlásený
 * request na `/`, `/nastavenia` alebo `/ai-agent` dostal 200 a kompletný shell
 * appky; klient potom vystrelil API volania a všetky spadli na JSON 401
 * (`SessionError`). Používateľ videl appku s červenými chybami („Chýba session
 * cookie — prihlás sa (D69)"), usúdil, že je pokazená, a pokúšal sa do nej
 * vložiť API kľúč — ten POST tiež skončil na 401 a kľúč sa nikdy neuložil.
 *
 * Middleware preto rozhoduje PRED renderom: bez platnej session ide request na
 * `/login`, nie na stránku.
 *
 * ROZDELENIE ZODPOVEDNOSTI (nesmie sa zmazať)
 * -------------------------------------------
 *  - **Stránky** (`page.tsx` pod `src/app`) — gatuje tento middleware
 *    presmerovaním 307 na `/login`.
 *  - **API rúty** (`/api/*`) — gatuje výhradne `defineRoute()` (A5) a MUSÍ
 *    ďalej vracať JSON 401 fail-closed. Middleware sa ich NESMIE dotknúť:
 *    presmerovanie API na HTML login by rozbilo kontrakt §5 aj testy. Preto sú
 *    `/api/*` mimo `matcher` a navyše ich odmieta `isGatedPagePath()`.
 *
 * BEH V NODE RUNTIME
 * ------------------
 * `config.runtime = 'nodejs'` je povinné: overenie session vedie cez
 * `loadSessionSecret()`, ktorý čita `SESSION_SECRET_FILE` z disku (§11). V Edge
 * runtime by `node:fs` neexistoval a gate by hodil výnimku pri každom requeste.
 *
 * FAIL-CLOSED
 * -----------
 * Akákoľvek chyba pri overovaní session (chýbajúca cookie, expirovaná session,
 * pozmenený podpis, nedostupný secret) znamená „neprihlásený". Neexistuje cesta,
 * ktorou by sa request s pochybnou session dostal na stránku.
 *
 * NÁVRAT NA ZAMÝŠĽANÚ CESTU
 * -------------------------
 * Cesta, kam používateľ pôvodne šiel, sa nesie dvoma spôsobmi:
 *  1. v query parametri `?next=` na `/login` (čitateľné, pre UI aj pre e2e),
 *  2. v krátkodobej httpOnly cookie `ovl_zliav_return_to`, ktorú middleware
 *     spotrebuje pri prvom prihlásenom requeste na `/` a presmeruje ním.
 * Druhá cesta je tá funkčná: `/login` po úspechu robí `router.replace('/')`
 * a query parameter by sa stratil. Cookie sa spotrebuje práve raz.
 *
 * Tento súbor NESMIE robiť nič iné než rozhodnutie „stránka vs. login".
 * Overovanie session vlastní A4 (`src/lib/auth/session.ts`), crypto A3.
 *
 * Vlastník: A4/A16. Strážené testom `test/unit/page-gate.spec.ts`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import type { SessionClaims } from '@/contracts';
import { readSessionCookie, verifySession } from '@/lib/auth/session';

/** Jediná verejná stránka appky. */
export const LOGIN_PATH = '/login';

/** Krátkodobá servisná cookie s cestou, kam používateľ pôvodne šiel. */
export const RETURN_TO_COOKIE_NAME = 'ovl_zliav_return_to';

/** Query parameter na `/login` so zamýšľanou cestou. */
export const NEXT_PARAM = 'next';

/** Zamýšľaná cesta prežije 10 minút — dosť na prihlásenie, nie viac. */
const RETURN_TO_MAX_AGE_SECONDS = 600;

/** Dlhšia cesta je nezmyselná a nemá čo skončiť v hlavičke `Location`. */
const MAX_RETURN_TO_LENGTH = 512;

/**
 * Prefixy, ktoré middleware NIKDY negatuje.
 *
 * `/api` je tu normatívne: API rúty držia vlastný fail-closed JSON 401 (A5)
 * a redirect by ich rozbil.
 */
const UNGATED_PREFIXES = ['/api', '/_next', LOGIN_PATH] as const;

/* ─────────────────────────────── cesty ─────────────────────────────────── */

function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Statické súbory z `public/` a `_next` — poznáme ich podľa prípony. */
function looksStatic(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return lastSegment.includes('.');
}

/**
 * Je táto cesta app stránka, ktorú treba chrániť?
 *
 * Fail-closed smerom: čokoľvek, čo nie je výslovne verejné alebo statické, sa
 * považuje za chránenú stránku. Nová stránka je teda chránená automaticky
 * a nikto na ňu nemusí pamätať.
 */
export function isGatedPagePath(pathname: string): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  for (const prefix of UNGATED_PREFIXES) {
    if (hasPrefix(pathname, prefix)) return false;
  }
  if (pathname === '/favicon.ico' || looksStatic(pathname)) return false;
  return true;
}

/** Riadiace znaky v hlavicke Location = header injection. Regex s nimi neprejde lintom. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Očistí kandidáta na návratovú cestu. Vracia `null`, keď sa cesta nedá
 * bezpečne použiť — volajúci potom presmeruje na `/` (fail-closed).
 *
 * Odmieta: absolútne URL a protocol-relative cesty (open redirect), cesty bez
 * úvodného `/`, `/login` (smyčka), `/api` a `/_next` (nie sú to stránky),
 * riadiace znaky (header injection) a priveľmi dlhé vstupy.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return null;
  // Riadiace znaky a whitespace nemajú v `Location` čo robiť.
  if (/\s/.test(value) || hasControlChar(value)) return null;
  if (!value.startsWith('/')) return null;
  // `//host` aj `/\host` prehliadač vyhodnotí ako iný origin.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;

  let parsed: URL;
  try {
    // Base je len na parsovanie — relatívnu cestu sme si už vynútili vyššie.
    parsed = new URL(value, 'https://ovl-zliav.invalid');
  } catch {
    return null;
  }
  if (!isGatedPagePath(parsed.pathname)) return null;

  return `${parsed.pathname}${parsed.search}`;
}

/* ─────────────────────────────── cookie ────────────────────────────────── */

/** Prečíta jednu cookie z hlavičky. Nezávisí od Next `cookies()` API, aby sa gate dal testovať nad obyčajným `Request`-om. */
function readCookie(cookieHeader: string | null, name: string): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    const value = pair.slice(index + 1).trim();
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function returnToCookieAttributes(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge,
  } as const;
}

/* ──────────────────────────────── gate ─────────────────────────────────── */

export interface PageGateDeps {
  /** Overenie session cookie. Default = A4 (`verifySession`). */
  verifySession: (token: string | null) => Promise<SessionClaims>;
}

/**
 * Gate potrebuje z requestu len URL a hlavičky. Štruktúrny typ (namiesto
 * `NextRequest`) drží gate testovateľný nad obyčajným `Request`-om — rovnaká
 * úvaha ako pri `RouteDeps` v A5.
 */
export type GateRequest = Pick<Request, 'url' | 'headers'>;

export type PageGate = (request: GateRequest) => Promise<NextResponse>;

/**
 * Zloží gate nad dodanou session vrstvou. Testy si podávajú vlastný
 * `verifySession` — rovnaký vzor ako `RouteDeps` v `defineRoute()` (A5).
 */
export function createPageGate(deps: PageGateDeps): PageGate {
  return async function gate(request: GateRequest): Promise<NextResponse> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const onLogin = hasPrefix(pathname, LOGIN_PATH);

    // Statické assety a `/api/*` idú rovno ďalej — API si 401 rieši samo (A5).
    if (!onLogin && !isGatedPagePath(pathname)) return NextResponse.next();

    const cookieHeader = request.headers.get('cookie');
    const token = readSessionCookie(cookieHeader);

    let authenticated = false;
    try {
      await deps.verifySession(token);
      authenticated = true;
    } catch {
      // Každá chyba = neprihlásený (fail-closed). Dôvod sa tu nelogujeme —
      // token ani cookie sa nikdy nesmú dostať do logu (I1).
      authenticated = false;
    }

    if (!authenticated) {
      if (onLogin) return NextResponse.next();
      return redirectToLogin(url, pathname);
    }

    // Prihlásený na `/login` alebo na dashboarde: dobehni tam, kam pôvodne šiel.
    if (onLogin || pathname === '/') {
      return consumeReturnTo(request, url, pathname, onLogin ? '/' : null);
    }

    return NextResponse.next();
  };
}

function redirectToLogin(url: URL, pathname: string): NextResponse {
  const target = sanitizeReturnTo(`${pathname}${url.search}`);

  const loginUrl = new URL(url.toString());
  loginUrl.pathname = LOGIN_PATH;
  loginUrl.search = '';
  loginUrl.hash = '';
  if (target !== null) loginUrl.searchParams.set(NEXT_PARAM, target);

  const response = NextResponse.redirect(loginUrl);
  if (target !== null) {
    response.cookies.set(
      RETURN_TO_COOKIE_NAME,
      target,
      returnToCookieAttributes(RETURN_TO_MAX_AGE_SECONDS),
    );
  } else {
    response.cookies.set(RETURN_TO_COOKIE_NAME, '', returnToCookieAttributes(0));
  }
  return response;
}

/**
 * Spotrebuje `ovl_zliav_return_to`. Cookie sa zahodí VŽDY, aj keď je jej obsah
 * nepoužiteľný — inak by sa používateľ nikdy nedostal na dashboard.
 */
function consumeReturnTo(
  request: GateRequest,
  url: URL,
  pathname: string,
  fallback: string | null,
): NextResponse {
  const stored = sanitizeReturnTo(readCookie(request.headers.get('cookie'), RETURN_TO_COOKIE_NAME));
  const target = stored !== null && stored !== `${pathname}${url.search}` ? stored : fallback;

  if (target === null) {
    const response = NextResponse.next();
    if (stored !== null) {
      response.cookies.set(RETURN_TO_COOKIE_NAME, '', returnToCookieAttributes(0));
    }
    return response;
  }

  const targetUrl = new URL(url.toString());
  targetUrl.search = '';
  targetUrl.hash = '';
  const [targetPath, targetQuery] = target.split('?', 2);
  targetUrl.pathname = targetPath;
  if (targetQuery !== undefined) targetUrl.search = targetQuery;

  const response = NextResponse.redirect(targetUrl);
  response.cookies.set(RETURN_TO_COOKIE_NAME, '', returnToCookieAttributes(0));
  return response;
}

/* ─────────────────────── produkčná instancia + config ──────────────────── */

const defaultGate = createPageGate({ verifySession });

export function middleware(request: NextRequest): Promise<NextResponse> {
  return defaultGate(request);
}

export const config = {
  /**
   * Overenie session čita `SESSION_SECRET_FILE` z disku — Edge runtime by to
   * neustál. Nemeniť.
   */
  runtime: 'nodejs',
  /**
   * `/api/*` je zámerne mimo matchera (JSON 401 vlastní A5) a s ním aj
   * `_next/*` a `favicon.ico`. Všetko ostatné prechádza gate-om, aby nová
   * stránka bola chránená automaticky.
   */
  matcher: ['/((?!api/|_next/|favicon\\.ico).*)'],
};
