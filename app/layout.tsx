import type { Metadata } from "next";
import { Anton, Geist, Geist_Mono } from "next/font/google";
import MotionProvider from "@/components/fx/MotionProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Condensed display face for the big moments (the headline, the full-screen idea reveal) —
// narrow enough that a whole idea title fits the viewport at poster size.
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "What To Do?",
  description: "From an idea to a scoped, scaffolded, running project in one prompt.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} dark h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
