import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Interface languages (#654, ADR-0028): points next-intl at the
// per-request configuration. No locale routing.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Standalone build = self-contained server.js + minimal node_modules.
  // Required for the multi-stage Dockerfile runtime layer.
  output: 'standalone',
  // Trace workspace deps so they're copied into the standalone bundle.
  outputFileTracingRoot: '../../',
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  transpilePackages: ['@oci/ui', '@oci/shared-types', '@oci/auth'],
  // Hide the Next.js dev tools widget. It pollutes the bottom-left
  // corner of every Playwright screenshot we capture for design
  // review (#79); developers can re-enable per-session via
  // `process.env.NEXT_DEV_INDICATORS=true` if needed.
  devIndicators: false,
  experimental: {
    // Server-action request bodies (#741): Next.js's default, 1 MB
    // (1,048,576 bytes), written down. The largest a page sends is a
    // predictions file of at most 512 KiB (the submit page refuses more)
    // or a pasted manifest. The API takes larger bodies from scripts
    // (docs/for-developers/api-reference.md, "Request size limits").
    // This applies to every server action, signed in or not, so raising
    // it widens what any visitor can make the web server read.
    serverActions: { bodySizeLimit: '1mb' },
  },
  // Since 16.4, `next dev` writes an AGENTS.md into apps/web when it detects
  // an AI coding agent, which then shows up untracked in every checkout
  // (#676). The repository keeps its contributor guidance elsewhere.
  agentRules: false,
  // The DICOM viewer's codecs (#674, ADR-0026) are WebAssembly modules
  // whose glue code contains `require('fs')` behind a Node-only guard.
  // Turbopack still has to resolve it for the browser bundle; point it
  // at an empty module there, and leave the server untouched.
  turbopack: {
    resolveAlias: {
      fs: { browser: './src/lib/empty-module.ts' },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
