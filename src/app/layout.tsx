import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { LocaleProvider } from "@/context/LocaleContext";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Meal Planner - Daily Meal Management",
  description: "Manage your daily meals with ease",
};

// No maximum-scale: users must be able to pinch-zoom (WCAG 1.4.4).
export const viewport: Viewport = {
  themeColor: "#2f3e46",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans" suppressHydrationWarning={true}>
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
