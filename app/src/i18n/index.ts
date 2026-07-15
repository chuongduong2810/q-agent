import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

/**
 * i18next bootstrap for the frontend (see ADR 0011).
 *
 * Every namespace catalog under `locales/<lng>/<ns>.json` is auto-discovered via
 * Vite's `import.meta.glob` and folded into i18next's `resources`. A feature
 * slice adds a namespace simply by dropping its two JSON files — no edit here —
 * which is what keeps the per-feature content slices file-disjoint and
 * parallel-safe. Catalogs are bundled eagerly so translations are available
 * synchronously (no Suspense needed).
 */
const modules = import.meta.glob("./locales/**/*.json", { eager: true });

type Catalog = Record<string, unknown>;
const resources: Record<string, Record<string, Catalog>> = {};
const namespaces = new Set<string>();

for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lng, ns] = match;
  const catalog = (mod as { default: Catalog }).default;
  (resources[lng] ??= {})[ns] = catalog;
  namespaces.add(ns);
}

/** The languages the UI ships in. `short` labels the compact TopBar switcher. */
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "vi", label: "Tiếng Việt", short: "VI" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

/** localStorage key the detector reads/writes — client-only preference. */
export const LANGUAGE_STORAGE_KEY = "qagent.lang";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: [...namespaces],
    defaultNS: "common",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    fallbackLng: "en",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

export default i18n;
