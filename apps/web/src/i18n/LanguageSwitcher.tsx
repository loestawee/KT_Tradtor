import { LOCALES, useLocaleStore, useT } from "./index";

/** Compact TH / EN segmented switch, usable in headers and toolbars. */
export const LanguageSwitcher: React.FC<{ className?: string }> = ({ className = "" }) => {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useT();

  return (
    <div
      role="radiogroup"
      aria-label={t("Language")}
      className={`inline-flex shrink-0 rounded-lg border border-border bg-background-secondary p-0.5 text-xs ${className}`}
    >
      {LOCALES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={locale === id}
          title={label}
          onClick={() => setLocale(id)}
          className={`min-w-9 rounded-md px-2 py-1 font-medium transition-colors ${
            locale === id
              ? "bg-primary text-white"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {id.toUpperCase()}
        </button>
      ))}
    </div>
  );
};
