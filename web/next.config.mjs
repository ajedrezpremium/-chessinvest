/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // En dev, el frontend puede llamar a /backend/* y Next lo proxya a Render/local.
    // En producción (Vercel) se usa NEXT_PUBLIC_API_URL directamente desde el cliente.
    const api = process.env.NEXT_PUBLIC_API_URL || 'https://chessinvest.onrender.com';
    return [{ source: '/backend/:path*', destination: `${api}/:path*` }];
  },
};

export default nextConfig;
