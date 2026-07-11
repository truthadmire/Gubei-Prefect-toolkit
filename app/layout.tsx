import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Gubei Prefect Toolkit";
const description = "Build balanced SUIS Gubei prefect room rotas quickly.";

type ParsedAuthority = {
  authority: string;
  hostname: string;
};

const firstHeaderValue = (value: string | null) => value?.split(",", 1)[0];

const parseAuthority = (candidate: string | undefined): ParsedAuthority | null => {
  if (
    !candidate ||
    candidate !== candidate.trim() ||
    /\s/.test(candidate) ||
    /[@/\\?#]/.test(candidate)
  ) {
    return null;
  }

  const ipv6Match = candidate.match(/^\[([0-9a-f:.]+)](?::([0-9]+))?$/i);
  const hostnameMatch = candidate.match(/^([a-z0-9.-]+)(?::([0-9]+))?$/i);
  const match = ipv6Match ?? hostnameMatch;
  if (!match) return null;

  const hostnameCandidate = ipv6Match ? `[${match[1]}]` : match[1];
  const portCandidate = match[2];
  if (portCandidate) {
    const port = Number(portCandidate);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;
  }

  const normalizedPort = portCandidate ? String(Number(portCandidate)) : "";
  const validatedAuthority = `${hostnameCandidate}${normalizedPort ? `:${normalizedPort}` : ""}`;
  try {
    const parsed = new URL(`http://${validatedAuthority}/`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname
    ) {
      return null;
    }
    const hostname = parsed.hostname.replace(/^\[|]$/g, "").toLowerCase();
    return {
      authority: `${parsed.hostname}${normalizedPort ? `:${normalizedPort}` : ""}`,
      hostname,
    };
  } catch {
    return null;
  }
};

const isLocalHost = (hostname: string) => {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const parsedAuthority =
    parseAuthority(firstHeaderValue(requestHeaders.get("x-forwarded-host"))) ??
    parseAuthority(firstHeaderValue(requestHeaders.get("host"))) ??
    { authority: "localhost", hostname: "localhost" };
  const forwardedProtocol = firstHeaderValue(requestHeaders.get("x-forwarded-proto"))
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : isLocalHost(parsedAuthority.hostname)
        ? "http"
        : "https";
  let metadataBase: URL;
  try {
    metadataBase = new URL(`${protocol}://${parsedAuthority.authority}`);
  } catch {
    metadataBase = new URL("http://localhost");
  }
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

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
