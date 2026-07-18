/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.ORS_NEXT_DIST_DIR || '.next-build',
  // Electron's renderer loads the local development server by its explicit
  // loopback address. Next 16 otherwise blocks HMR and development font
  // resources as cross-origin, leaving desktop reviewers on stale UI.
  allowedDevOrigins: ['127.0.0.1'],
  typescript: {
    tsconfigPath: './tsconfig.next.json'
  }
};

export default nextConfig;
