import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Katan',
    short_name: 'Katan',
    description: 'קטאן עם החברים, מכל טלפון',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f3b47',
    theme_color: '#0f3b47',
    lang: 'he',
    dir: 'rtl',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
