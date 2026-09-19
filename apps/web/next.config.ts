import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@adc/contracts'],
  poweredByHeader: false,
};

export default nextConfig;
