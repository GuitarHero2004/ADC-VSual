import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@adc/contracts', '@adc/voice-ui'],
  poweredByHeader: false,
};

export default nextConfig;
