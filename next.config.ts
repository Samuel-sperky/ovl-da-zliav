import type { NextConfig } from 'next';

/**
 * Aura Zľavy — Next.js konfigurácia (R3, D95, D98).
 *
 * - `output: 'standalone'` — appka beží ako samostatný `server.js` v kontajneri
 *   (Dockerfile vlastní A14).
 * - `poweredByHeader: false` — hlavička `X-Powered-By` sa neposiela; ostatné
 *   security hlavičky pridáva Caddy (D95).
 * - Doména shopu NIE JE v konfigurácii ani v ENV — žije v `settings.shop_domain`
 *   a zadáva sa v UI (R5, D80).
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  /* Vývojový odznak Next.js (tmavý kruh vľavo dole) sa nekreslí. Nie je to
     kozmetika: e2e harness (test/e2e/serve.ts) spúšťa `next dev`, takže odznak
     končil na KAŽDEJ snímke a prekrýval obsah — na Produktoch filter
     „Obrátkovosť", na detaile zľavy vetu o vlastných zápisoch. Snímky sú doklad
     k akceptačným kritériám, odznak cez ne je chyba v dôkaze (D1, 19. 8. 2026). */
  devIndicators: false,
  // `instrumentation.ts` (boot assertions + scheduler) beží v Node runtime.
  serverExternalPackages: ['mariadb', 'argon2'],
  typescript: {
    // Typecheck beží ako samostatný krok (`npm run typecheck`).
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
