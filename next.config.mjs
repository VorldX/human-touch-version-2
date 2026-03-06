const DEFAULT_SERVER_ACTION_ORIGINS = [
  "localhost:3000",
  "127.0.0.1:3000",
  "localhost:3001",
  "127.0.0.1:3001",
  "localhost:3002",
  "127.0.0.1:3002",
  "app:3000",
  "app:3001",
  "app:3002"
];

const envAllowedOrigins = (process.env.NEXT_SERVER_ACTION_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedServerActionOrigins = [
  ...new Set([...DEFAULT_SERVER_ACTION_ORIGINS, ...envAllowedOrigins])
];

const isOneDriveWorkspace = /(^|[\\/])onedrive([\\/]|$)/i.test(process.cwd());
const configuredDistDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: configuredDistDir,
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionOrigins
    }
  },
  webpack: (config, { dev }) => {
    // OneDrive frequently locks Next.js cache files on Windows and causes random 500s.
    if (dev && isOneDriveWorkspace) {
      config.cache = false;
    }

    return config;
  }
};

export default nextConfig;
