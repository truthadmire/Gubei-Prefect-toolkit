import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gubei Prefect Toolkit",
  description: "Build balanced SUIS Gubei prefect room rotas quickly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
