import { getLocale, getTranslations } from 'next-intl/server';
import { switchLocaleAction } from '../i18n/actions';
import { localeName, LOCALES } from '../i18n/locales';

/**
 * The header's language switch (#654): one button per interface
 * language, the current one marked. A plain form posting to a server
 * action, so it works before the page's script has loaded. Each button
 * shows the language's code and is named in its own language, with
 * `lang` set so a screen reader pronounces it right.
 */
export async function LanguageSwitch() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('LanguageSwitch')]);
  return (
    <form action={switchLocaleAction}>
      <div
        role="group"
        aria-label={t('label')}
        className="inline-flex items-center rounded-md border border-[var(--color-border)] p-0.5"
      >
        {LOCALES.map((option) => {
          const current = option === locale;
          return (
            <button
              key={option}
              type="submit"
              name="locale"
              value={option}
              lang={option}
              aria-pressed={current}
              className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ${
                current
                  ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
              }`}
            >
              {option.toUpperCase()}
              <span className="sr-only"> {localeName(option)}</span>
            </button>
          );
        })}
      </div>
    </form>
  );
}
