'use client';

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { IconButton } from './icon-button.js';
import { CloseIcon } from './icon.js';

export interface DialogProps {
  /** Controlled visibility. The parent owns the state. */
  open: boolean;
  /**
   * Called whenever the dialog wants to close — the close button, the
   * backdrop, or `Escape` (via the native `close` event). The parent
   * must flip `open` to `false` in response.
   */
  onClose: () => void;
  /**
   * Accessible name. Rendered as the panel heading and wired through
   * `aria-labelledby`, so it must be meaningful on its own (a filename,
   * not "Preview").
   */
  title: ReactNode;
  /** Optional sub-line under the title, wired through `aria-describedby`. */
  description?: ReactNode;
  children: ReactNode;
  /** Extra classes on the panel — not the backdrop. */
  className?: string;
  /** Accessible name of the close button. */
  closeLabel?: string;
}

/**
 * Modal dialog built on the native `<dialog>` element.
 *
 * We use `showModal()` rather than hand-rolling a modal because the
 * platform already implements the hard parts and implements them
 * correctly: focus is trapped inside the dialog, everything behind it
 * is inert, `Escape` closes, the element sits in the top layer (so no
 * z-index arms race), and `aria-modal` is implied. What's left for us
 * is what the platform doesn't do:
 *
 *   - move focus to a *known* element on open (the browser's own choice
 *     is the first focusable descendant, which is fine here but not
 *     guaranteed to stay first as callers add content);
 *   - restore focus to the trigger on close, including when the dialog
 *     is unmounted while open (the platform only restores on `close()`);
 *   - close on backdrop click, which the platform deliberately leaves
 *     to the author;
 *   - suppress background scrolling.
 *
 * Either mounting style works. Keep it mounted and drive it with `open`
 * for a cheap dialog; mount it only while open (`{open ? <Dialog open …>`)
 * when the content isn't free — a closed `<dialog>` is `display: none`,
 * but the browser still fetches an `<img>` inside it, and its heading
 * still sits in the DOM. Focus is restored to the trigger either way.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  closeLabel = 'Close dialog',
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // `Escape` doesn't run through our handlers, so mirror the platform's
  // dismissal back to the parent. This listens for `cancel` (fired only
  // for a user close request) rather than `close` (fired by *any* close,
  // including our own `el.close()` in the cleanup below) — otherwise a
  // programmatic close would loop back in as if the user had asked for
  // it, which under React StrictMode's mount/unmount/mount would slam
  // the dialog shut the instant it opened in development.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleCancel = () => onCloseRef.current();
    el.addEventListener('cancel', handleCancel);
    return () => el.removeEventListener('cancel', handleCancel);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el || !open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    // `showModal()` on an already-open dialog throws InvalidStateError.
    if (!el.open) el.showModal();
    closeButtonRef.current?.focus();
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      if (el.open) el.close();
      // Chromium restores focus itself on `close()`, but not when the
      // element is removed from the DOM while still open — and a
      // caller that conditionally renders the dialog does exactly
      // that. Restoring here covers both paths and is idempotent.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  const handleSurfaceClick = (event: MouseEvent<HTMLDialogElement>) => {
    // The backdrop is painted by the dialog element itself, so a click
    // outside the panel lands on the element rather than a child.
    if (event.target === dialogRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={handleSurfaceClick}
      className="fixed inset-0 m-0 h-full max-h-full w-full max-w-full bg-transparent p-4 text-[var(--color-foreground)] backdrop:bg-[var(--color-overlay)] open:flex open:items-center open:justify-center sm:p-6"
    >
      <div
        className={cn(
          'flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-lg)]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-mono text-sm font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton
            ref={closeButtonRef}
            label={closeLabel}
            variant="outline"
            onClick={onClose}
            className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
          >
            <CloseIcon size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}
