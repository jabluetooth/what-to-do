import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Generated App",
  description: "Scaffolded by What To Do?",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
