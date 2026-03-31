const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /\/(orders\/orders|orders\/order\/.*\/status|invoice\/invoices|images\/upload)/i,
      handler: 'NetworkOnly',
      method: 'POST',
      options: {
        backgroundSync: {
          name: 'orders-write-queue',
          options: { maxRetentionTime: 24 * 60 },
        },
      },
    },
    {
      urlPattern: /\/(orders\/orders\/.+|orders\/order\/.*\/status|invoice\/invoices\/.+\/pod)/i,
      handler: 'NetworkOnly',
      method: 'PUT',
      options: {
        backgroundSync: {
          name: 'orders-update-queue',
          options: { maxRetentionTime: 24 * 60 },
        },
      },
    },
    {
      urlPattern: /\/invoice\/invoices\/.+\/pod/i,
      handler: 'NetworkOnly',
      method: 'PATCH',
      options: {
        backgroundSync: {
          name: 'pod-patch-queue',
          options: { maxRetentionTime: 24 * 60 },
        },
      },
    },
    {
      urlPattern: /^https?.*\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-assets-v1',
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

module.exports =
  process.env.NODE_ENV === 'production'
    ? withPWA(nextConfig)
    : nextConfig;
