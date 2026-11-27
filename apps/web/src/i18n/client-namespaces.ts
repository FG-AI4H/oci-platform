import type { Messages } from './messages/en';

/**
 * The namespaces client components read (`useTranslations` in a
 * `'use client'` file). Only these, in the request's language only,
 * travel to the browser; server components read the rest on the
 * server. `client-namespaces.spec.ts` fails when a client component
 * uses a namespace missing from this list.
 */
export const CLIENT_NAMESPACES = [
  'AccessRequest',
  'Annotate',
  'Campaign',
  'CatalogNew',
  'Common',
  'Dataset',
  'DicomViewer',
  'EvaluationDeclare',
  'EvaluationReview',
  'EvaluationSubmit',
  'ModelCardForm',
  'Provenance',
  'Publish',
  'Settings',
  'SignIn',
  'ToolsetForm',
] as const satisfies readonly (keyof Messages)[];

export function clientMessages(messages: Messages): Partial<Messages> {
  const listed = new Set<string>(CLIENT_NAMESPACES);
  return Object.fromEntries(
    Object.entries(messages).filter(([namespace]) => listed.has(namespace)),
  ) as Partial<Messages>;
}
