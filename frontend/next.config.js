/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack: (config) => {
    // wagmi's Coinbase Smart Wallet connector (pulled in transitively via
    // @reown/appkit-adapter-wagmi) optionally imports Coinbase's x402/CDP
    // SDKs, which we never use (no Coinbase Smart Wallet / x402 payments
    // here) and don't have installed. Ignore them instead of installing
    // an unused dependency tree.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account": false,
      "@coinbase/cdp-sdk": false,
    };
    return config;
  },
};
module.exports = nextConfig;
