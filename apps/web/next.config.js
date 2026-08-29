/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The API is a separate Express service, so Next never proxies to it and
  // never runs route handlers of its own. NEXT_PUBLIC_API_URL is read by the
  // browser client that arrives at step 1.11.
  //
  // Linting is not configured here: Next 16 removed the `eslint` key, and the
  // repository root runs one ESLint pass across every workspace anyway.
};

export default nextConfig;
