import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Al Ras Steel MTC Tracker",
  description: "Mill test certificate tracker for Al Ras Steel",
};

// Fonts load in the browser (with system fonts as fallback), so builds never depend on reaching Google Fonts.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
