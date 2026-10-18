import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { th } from "./th";

// KT ตัดต่อ: lightweight UI translation. Strings are keyed by their English
// source text, so untranslated UI keeps working and upstream diffs stay small:
// wrap a literal as t("Export") and add its Thai text to ./th.ts.

export type Locale = "th" | "en";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "th", label: "ไทย" },
  { id: "en", label: "English" },
];

const dictionaries: Record<Locale, Record<string, string>> = { th, en: {} };

function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "th";
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith("en")) &&
    !langs.some((l) => l?.toLowerCase().startsWith("th"))
    ? "en"
    : "th";
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  // Desktop: keep the native menu bar in the same language.
  if (typeof window !== "undefined") window.openreel?.setUiLocale?.(locale);
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      setLocale: (locale) => {
        applyDocumentLang(locale);
        set({ locale });
      },
    }),
    {
      name: "kt-locale",
      onRehydrateStorage: () => (state) => applyDocumentLang(state?.locale ?? detectLocale()),
    },
  ),
);

/** Replaces {name} placeholders with values. */
function format(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** Translate outside React (reads the current locale once). */
export function translate(text: string, vars?: Record<string, string | number>): string {
  const locale = useLocaleStore.getState().locale;
  return format(dictionaries[locale][text] ?? text, vars);
}

export type TFunction = (text: string, vars?: Record<string, string | number>) => string;

/** React hook: components re-render when the language changes. */
export function useT(): TFunction {
  const locale = useLocaleStore((s) => s.locale);
  return useCallback(
    (text: string, vars?: Record<string, string | number>) =>
      format(dictionaries[locale][text] ?? text, vars),
    [locale],
  );
}
