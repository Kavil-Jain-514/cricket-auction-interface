import type { Metadata } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

// Display face (font-head): the logo, headings and prices, condensed with
// tabular figures. It has no ₹ glyph; PriceTicker sets ₹ in Inter.
const display = Barlow_Condensed({
  weight: ['600', '700'],
  subsets: ['latin'],
  variable: '--font-head-face',
  display: 'swap',
});

// Clerk and Convex live in app/(app)/layout.tsx, not here: the marketing
// pages in app/(marketing) are static and must not ship those bundles.
// No canonical here: a root canonical would be inherited by every page.
export const metadata: Metadata = {
  metadataBase: new URL('https://bid11pro.kaviljain.com'),
  title: {
    default: 'Bid11Pro - Cricket Auction Software for IPL-Style Player Auctions',
    template: '%s | Bid11Pro',
  },
  description: 'Run an IPL-style cricket player auction for your local tournament: live bidding from phones, team purses checked on the server, a projector view and a broadcast overlay.',
  keywords: ['cricket auction software', 'IPL style auction app', 'player auction for local tournament', 'cricket player auction', 'Bid11Pro'],
  applicationName: 'Bid11Pro',
  openGraph: {
    type: 'website',
    siteName: 'Bid11Pro',
    locale: 'en_IN',
    title: 'Bid11Pro - Cricket Auction Software',
    description: 'Run an IPL-style player auction for your tournament, with live bidding, server-checked purses and a projector view.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bid11Pro - Cricket Auction Software',
    description: 'Run an IPL-style player auction for your tournament, with live bidding, server-checked purses and a projector view.',
  },
  robots: {
    index: true,
    follow: true,
  },
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${display.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
