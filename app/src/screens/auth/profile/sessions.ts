import type { ComponentType } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";

/** Derive a friendly "OS · Browser" label + device icon from a raw User-Agent. */
export function describeSession(userAgent: string): {
  label: string;
  Icon: ComponentType<{ size?: number | string; className?: string }>;
} {
  const ua = userAgent || "";
  const l = ua.toLowerCase();

  const isTablet = /ipad|tablet/.test(l);
  const isPhone = /iphone|android(?!.*tablet)|mobile/.test(l);

  let os = "Unknown device";
  if (/windows/.test(l)) os = "Windows";
  else if (/iphone|ipad|ipod/.test(l)) os = /ipad/.test(l) ? "iPad" : "iPhone";
  else if (/mac os x|macintosh/.test(l)) os = "macOS";
  else if (/android/.test(l)) os = "Android";
  else if (/linux/.test(l)) os = "Linux";

  let browser = "";
  if (/edg\//.test(l)) browser = "Edge";
  else if (/opr\/|opera/.test(l)) browser = "Opera";
  else if (/chrome|crios/.test(l)) browser = "Chrome";
  else if (/firefox|fxios/.test(l)) browser = "Firefox";
  else if (/safari/.test(l)) browser = "Safari";

  const Icon = isPhone ? Smartphone : isTablet ? Tablet : Monitor;
  const label = browser ? `${os} · ${browser}` : os;
  return { label, Icon };
}

/** Compact relative time ("Active now", "3 hours ago", "2 days ago"). */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "Active now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}
