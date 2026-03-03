import type { Metadata } from "next";
import { Orbitron, Rajdhani } from "next/font/google";

import { FirebaseAuthProvider } from "@/components/auth/firebase-auth-provider";

import "./globals.css";

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  weight: ["500", "700", "900"]
});

const rajdhani = Rajdhani({
  subsets: ["latin"],
  variable: "--font-rajdhani",
  weight: ["400", "500", "600", "700"]
});

export const metadata: Metadata = {
  title: "Human Touch | Organization AI",
  description:
    "Talk to your organization, extract direction, and let the Main Agent orchestrate multi-agent execution."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${orbitron.variable} ${rajdhani.variable}`}>
        <FirebaseAuthProvider>{children}</FirebaseAuthProvider>
      </body>
    </html>
  );
}
