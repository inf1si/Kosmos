import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const config: NextConfig = {
  poweredByHeader: false,
  // Link preview scrapers that read only <head> (KakaoTalk among them) are not all on the built-in list, so metadata is never streamed late.
  htmlLimitedBots: /.*/,
  outputFileTracingIncludes: {
    '/opengraph-image': ['./node_modules/@kfonts/maruburi/MaruBuri-{Regular,Bold}.woff'],
    '/read/[workId]/opengraph-image': ['./node_modules/@kfonts/maruburi/MaruBuri-{Regular,Bold}.woff'],
  },
  async headers() {
    return [{source: '/:path*', headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
      {key: 'X-Frame-Options', value: 'DENY'},
    ]}];
  },
};

export default withWorkflow(config);
