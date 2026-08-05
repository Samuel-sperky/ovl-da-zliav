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
  // `instrumentation.ts` (boot assertions + scheduler) beží v Node runtime.
  serverExternalPackages: ['mariadb', 'argon2'],
  typescript: {
    // Typecheck beží ako samostatný krok (`npm run typecheck`).
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
