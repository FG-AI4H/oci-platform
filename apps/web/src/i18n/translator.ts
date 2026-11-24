import type { Messages } from './messages/en';

/**
 * The message keys of one namespace, as dotted paths (`metric.qwk.label`).
 * Built from the English catalogue, like next-intl's own key check.
 */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey<N extends keyof Messages> = Leaves<Messages[N]>;

/**
 * `t` for one namespace, reduced to what a plain module needs: a key and
 * its ICU values, a string back (#654). What `getTranslations`,
 * `useTranslations` and `createTranslator` return all fit it, so a helper
 * that takes one can be called from a server component, a client
 * component, a server action or a unit test alike, and never has to load
 * a catalogue itself.
 */
export type Translator<N extends keyof Messages> = (
  key: MessageKey<N>,
  values?: Record<string, string | number>,
) => string;
