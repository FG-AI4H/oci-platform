'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Field, Textarea } from '@oci/ui';
import {
  CANNOT_ASSESS_LABEL,
  LABEL_COMMENT_MAX,
  type ClassificationLabelsConfig,
} from '@oci/shared-types';
import { digitOf, isTypingTarget } from './keyboard';

interface LabelChoicesProps {
  labels: ClassificationLabelsConfig;
  /**
   * Arbitration (#646): the legend becomes "Final label" and a required
   * "Reason" box replaces the optional comment.
   */
  reasonRequired?: boolean;
  /** The reader's last answer, as JSON, when a submit was refused. */
  echoed: string | null;
}

/**
 * The campaign's labels as radio buttons (#646). Keys 1–9 pick the
 * labels in order and 0 picks "Cannot assess"; Enter submits. The
 * digit is read from the physical key, so the top row works on a French
 * keyboard too (#646 review, item 4). Both are
 * ignored while typing a comment. The form posts `label` and `comment`,
 * which the submit action turns into the `{ label, comment }` payload;
 * at arbitration it posts `label` and `reason`.
 */
export function LabelChoices({ labels, reasonRequired = false, echoed }: LabelChoicesProps) {
  const t = useTranslations('Annotate');
  const previous = parseEchoed(echoed);
  const [picked, setPicked] = useState<string | null>(previous.label);
  const legendId = useId();
  const commentId = useId();
  const groupRef = useRef<HTMLFieldSetElement>(null);

  const options = [
    ...labels.labels.map((l, i) => ({ value: l.value, display: l.display, digit: i + 1 })),
    ...(labels.cannotAssess
      ? [{ value: CANNOT_ASSESS_LABEL, display: t('cannotAssess'), digit: 0 }]
      : []),
  ];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A key the focused viewer already used (an arrow, a zoom key)
      // is not also an answer (#646 review).
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const group = groupRef.current;
      if (!group) return;
      if (e.key === 'Enter') {
        // Enter on a button already submits; elsewhere, submit the form.
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        e.preventDefault();
        group.form?.requestSubmit();
        return;
      }
      const digit = digitOf(e);
      const option = digit === null ? undefined : options.find((o) => o.digit === digit);
      if (!option) return;
      e.preventDefault();
      setPicked(option.value);
      group.querySelector<HTMLInputElement>(`input[value="${CSS.escape(option.value)}"]`)?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className="space-y-4">
      <input type="hidden" name="mode" value="labels" />
      <fieldset ref={groupRef} aria-labelledby={legendId} className="space-y-2">
        <legend id={legendId} className="text-sm font-medium">
          {reasonRequired ? t('labels.finalLabel') : t('labels.yourAnswer')}{' '}
          <span className="font-normal text-[var(--color-muted-foreground)]">
            {t('labels.pressNumber')}
          </span>
        </legend>
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-soft)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ring)]"
          >
            <input
              type="radio"
              name="label"
              value={o.value}
              required
              checked={picked === o.value}
              onChange={() => setPicked(o.value)}
              className="accent-[var(--color-primary)]"
            />
            <kbd
              aria-hidden="true"
              className="inline-grid h-6 w-6 place-items-center rounded border border-[var(--color-border)] font-mono text-xs"
            >
              {o.digit}
            </kbd>
            <span>{o.display}</span>
          </label>
        ))}
      </fieldset>
      {reasonRequired ? (
        <Field label={t('labels.reason')} htmlFor={commentId} hint={t('labels.reasonHint')}>
          <Textarea
            id={commentId}
            name="reason"
            rows={3}
            required
            maxLength={LABEL_COMMENT_MAX}
            defaultValue={previous.reason}
          />
        </Field>
      ) : labels.allowComment ? (
        <Field label={t('labels.comment')} htmlFor={commentId} hint={t('labels.optional')}>
          <Textarea
            id={commentId}
            name="comment"
            rows={3}
            maxLength={LABEL_COMMENT_MAX}
            defaultValue={previous.comment}
          />
        </Field>
      ) : null}
    </div>
  );
}

function parseEchoed(echoed: string | null): {
  label: string | null;
  comment: string;
  reason: string;
} {
  const empty = { label: null, comment: '', reason: '' };
  if (!echoed) return empty;
  try {
    const v = JSON.parse(echoed) as { label?: unknown; comment?: unknown; reason?: unknown };
    return {
      label: typeof v.label === 'string' ? v.label : null,
      comment: typeof v.comment === 'string' ? v.comment : '',
      reason: typeof v.reason === 'string' ? v.reason : '',
    };
  } catch {
    return empty;
  }
}
