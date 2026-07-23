import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const poppins = Poppins({
  weight: ['400', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://bid11pro.kaviljain.com'),
  title: {
    default: 'Bid11Pro - Professional Cricket Auction Platform',
    template: '%s | Bid11Pro',
  },
  description: 'The ultimate cricket auction management system with real-time bidding, team management, and live statistics. Experience the thrill of IPL-style auctions!',
  keywords: ['cricket', 'auction', 'IPL', 'tournament', 'bidding', 'Bid11Pro', 'fantasy cricket', 'player auction'],
  applicationName: 'Bid11Pro',
  openGraph: {
    type: 'website',
    siteName: 'Bid11Pro',
    title: 'Bid11Pro - Professional Cricket Auction Platform',
    description: 'Real-time IPL-style cricket auctions with live bidding, team management, and statistics.',
    url: 'https://bid11pro.kaviljain.com',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bid11Pro - Professional Cricket Auction Platform',
    description: 'Real-time IPL-style cricket auctions with live bidding, team management, and statistics.',
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
        className={`${inter.variable} ${poppins.variable} font-sans antialiased`}
      >
        <Providers>
          {children}
        </Providers>
        {/* Single global Toaster lives in providers.tsx — a second one here
            rendered every toast twice. (P1-5) */}
      </body>
    </html>
  );
}
