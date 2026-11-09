import type { Metadata, Viewport } from 'next';
import { Lexend, Roboto_Mono } from 'next/font/google';
import NoBounce from '@/components/NoBounce';
import ButtonClickSound from '@/components/ButtonClickSound';
import './globals.css';

// Fonts are self-hosted by Next at build time (no runtime request to Google, no flash of Arial).
const lexend = Lexend({ subsets: ['latin'], display: 'swap', variable: '--font-lexend' });
const robotoMono = Roboto_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-roboto-mono' });

export const metadata: Metadata = {
  title: 'iQuizify',
  description: 'Quizzes & assessments for your classroom',
  icons: {
    icon: '/logo.svg',
    shortcut: '/logo.svg',
    apple: '/logo.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#F0F9F6',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${robotoMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="preload" href="/logo.svg" as="image" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body suppressHydrationWarning>
        <ButtonClickSound />
        <NoBounce />
        <div className="hexfield" />
        <div className="bg-orbs" aria-hidden="true">
          <div className="bg-orb bg-orb-1" />
          <div className="bg-orb bg-orb-2" />
        </div>
        <div className="wrap">{children}</div>
        <div id="toastRoot" />
      </body>
    </html>
  );
} 