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
  title: 'Bid11Pro - Professional Cricket Auction Platform',
  description: 'The ultimate cricket auction management system with real-time bidding, team management, and live statistics. Experience the thrill of IPL-style auctions!',
  keywords: ['cricket', 'auction', 'IPL', 'tournament', 'bidding', 'Bid11Pro', 'fantasy cricket', 'player auction'],
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
