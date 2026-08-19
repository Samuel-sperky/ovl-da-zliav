/**
 * Aura Zľavy — MERANIE FARIEB (kontrakt UX/dizajn 19. 8. 2026, vlna F).
 *
 * Prečo to tu vôbec je: v tomto projekte sa už raz stalo, že jantárová
 * `#B45309` vyzerala v editore úplne inak než červená `#C62F26`, a pod
 * deuteranopiou mali odstup ΔE 0,9 — teda boli to pre časť používateľov tie
 * isté dve farby. Oko to nezistí. Preto sa paleta v tejto appke **meria**,
 * nie posudzuje.
 *
 * Súbor je zámerne bez závislostí: WCAG kontrast, simulácia farbosleposti
 * (Brettel/Viénot v LMS) a CIEDE2000. Používa ho `test/unit/paleta.spec.ts`,
 * ktorý číta skutočné tokeny z `src/app/globals.css` — takže test nemeria
 * kópiu palety, ale tú, ktorá sa naozaj vykresľuje.
 *
 * PASCA, KTORÁ TU UŽ RAZ BOLA: `lin()` si delenie 255 robí samo. Kto do
 * `toLab()` pošle hodnoty už vydelené 255, dostane takmer čiernu a VŠETKY ΔE
 * mu vyjdú okolo 0,2 — teda „paleta je úplne nerozlíšiteľná". Vyzerá to ako
 * nález, je to chyba v mierke. Preto má tento súbor vlastný self-test
 * (`SELF_TEST`), ktorý sa spúšťa ako prvý prípad v spec súbore.
 */

export type Rgb = readonly [number, number, number];
export type CvdKind = 'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia';

export function hexToRgb(h: string): Rgb {
  const s = h.trim().replace('#', '');
  const n = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(n)) throw new Error(`nečitateľná farba: ${h}`);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as unknown as Rgb;
}

/* ── WCAG ─────────────────────────────────────────────────────────────── */

/** Vstup 0–255. Delenie 255 patrí SEM a nikam inam. */
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(rgb: Rgb): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(hexToRgb(fg)), luminance(hexToRgb(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── Simulácia farbosleposti ──────────────────────────────────────────── */

const RGB2LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
] as const;

const LMS2RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
] as const;

const CVD = {
  deuteranopia: [
    [1, 0, 0],
    [0.9513092, 0, 0.04866992],
    [0, 0, 1],
  ],
  protanopia: [
    [0, 1.05118294, -0.05116099],
    [0, 1, 0],
    [0, 0, 1],
  ],
  tritanopia: [
    [1, 0, 0],
    [0, 1, 0],
    [-0.86744736, 1.86727089, 0],
  ],
} as const satisfies Record<Exclude<CvdKind, 'normal'>, readonly (readonly number[])[]>;

function apply(m: readonly (readonly number[])[], v: readonly number[]): [number, number, number] {
  return m.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!) as [number, number, number];
}

function toLinear(rgb: Rgb): [number, number, number] {
  return [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];
}

function fromLinear(v: readonly number[]): Rgb {
  return v.map((x) => {
    const c = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  }) as unknown as Rgb;
}

/** Ako farbu vidí oko s daným typom farbosleposti. */
export function simulate(hex: string, kind: CvdKind): Rgb {
  if (kind === 'normal') return hexToRgb(hex);
  return fromLinear(apply(LMS2RGB, apply(CVD[kind], apply(RGB2LMS, toLinear(hexToRgb(hex))))));
}

/* ── CIEDE2000 ────────────────────────────────────────────────────────── */

/** Vstup 0–255. */
function toLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = toLinear(rgb);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export function deltaE(c1: Rgb, c2: Rgb): number {
  const [L1, a1, b1] = toLab(c1);
  const [L2, a2, b2] = toLab(c2);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G);
  const ap2 = a2 * (1 + G);
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const ang = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    const d = (Math.atan2(b, ap) * 180) / Math.PI;
    return d >= 0 ? d : d + 360;
  };
  const hp1 = ang(b1, ap1);
  const hp2 = ang(b2, ap2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * Math.PI) / 360);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hpb = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hpb += hpb < 360 ? 360 : -360;
    hpb /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos(((hpb - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hpb * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hpb + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hpb - 63) * Math.PI) / 180);
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt =
    -2 *
    Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7)) *
    Math.sin((60 * Math.exp(-(((hpb - 275) / 25) ** 2)) * Math.PI) / 180);
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/* ── Odstup dvojíc naprieč typmi videnia ──────────────────────────────── */

export const CVD_KINDS: readonly CvdKind[] = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'];

export interface PairDistance {
  kind: CvdKind;
  pair: string;
  deltaE: number;
}

/** Najtesnejšia dvojica naprieč všetkými typmi videnia. */
export function tightestPairs(colors: Record<string, string>): PairDistance[] {
  const names = Object.keys(colors);
  const out: PairDistance[] = [];
  for (const kind of CVD_KINDS) {
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i]!;
        const b = names[j]!;
        out.push({
          kind,
          pair: `${a} ↔ ${b}`,
          deltaE: Number(deltaE(simulate(colors[a]!, kind), simulate(colors[b]!, kind)).toFixed(1)),
        });
      }
    }
  }
  return out.sort((x, y) => x.deltaE - y.deltaE);
}

/**
 * Kontrola samotnej matematiky. Keby sa pomýlila mierka (pozri hlavičku),
 * všetky ΔE spadnú k nule a paleta by prešla ako „dokonalá" alebo by naopak
 * vyzerala ako úplne rozbitá. Tieto hodnoty sú overiteľné zvonka.
 */
export const SELF_TEST: readonly { name: string; actual: () => number; expect: [number, number] }[] =
  [
    { name: 'biela/čierna = 21:1', actual: () => contrast('#ffffff', '#000000'), expect: [20.9, 21.1] },
    { name: '#767676 na bielej = 4,54:1', actual: () => contrast('#767676', '#ffffff'), expect: [4.5, 4.6] },
    { name: 'tá istá farba ΔE = 0', actual: () => deltaE(hexToRgb('#c62f26'), hexToRgb('#c62f26')), expect: [0, 0.001] },
    { name: 'červená ↔ zelená ΔE ≈ 86', actual: () => deltaE(hexToRgb('#ff0000'), hexToRgb('#00ff00')), expect: [83, 89] },
    {
      name: 'červená ↔ zelená pod deuteranopiou splýva',
      actual: () => deltaE(simulate('#ff0000', 'deuteranopia'), simulate('#00ff00', 'deuteranopia')),
      expect: [0, 25],
    },
    {
      name: 'historický nález #B45309 ↔ #C62F26 pod deuteranopiou',
      actual: () => deltaE(simulate('#B45309', 'deuteranopia'), simulate('#C62F26', 'deuteranopia')),
      expect: [0, 4],
    },
  ];
