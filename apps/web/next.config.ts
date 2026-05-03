import type { NextConfig } from 'next';

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

export default nextConfig;
