import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../providers/Providers";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "PayLink - Shareable Payment Links on Solana",
  description: "Send. Receive. Off-ramp. All on Solana.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
