/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export keeps it deployable anywhere (Vercel, S3, GitHub Pages) and
  // guarantees there is no server touching user data.
  output: "export",
  images: { unoptimized: true },
  // The engine package is consumed as source TS from the workspace; let Next
  // transpile it.
  transpilePackages: ["@stocks-portfolio-irpf/engine"],
};
export default nextConfig;
