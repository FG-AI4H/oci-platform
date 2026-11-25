'use client';

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@oci/ui';
import { isTypingTarget, zoomOf } from './keyboard';
import { useReportSampleReady } from './sample-ready';

interface ImageViewerProps {
  /** Short-lived address of the image (#646). */
  src: string;
  /** Neutral description: no file name, which may carry the answer (ADR-0010). */
  alt: string;
}

interface ViewState {
  zoom: number;
  x: number;
  y: number;
  invert: boolean;
  brightness: number;
  contrast: number;
}

/** One toolbar button. All share one style; only these vary. */
interface ViewControl {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Set for toggles (Invert), so the button reports its state. */
  pressed?: boolean;
}

const FIT: ViewState = { zoom: 1, x: 0, y: 0, invert: false, brightness: 100, contrast: 100 };
const ZOOM_STEP = 1.25;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const PAN_STEP = 40;
const LEVEL_STEP = 10;
const LEVEL_MIN = 20;
const LEVEL_MAX = 300;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The image on the annotate page (#646): fit to screen, zoom, pan,
 * invert, brightness and contrast. Every control is a button, and has a
 * key that works anywhere on the page except while typing:
 *
 *   + / -    zoom in / out        F   fit to screen (resets everything)
 *   I        invert               B / Shift+B   brightness up / down
 *   C / Shift+C   contrast up / down
 *   arrows   pan, while the image has focus (elsewhere they move
 *            between the label choices)
 *
 * Digits are left to the label form, and zoom ignores the digit row,
 * where a French keyboard puts - and _ (#646 review, item 4). Zoom and filters are CSS, so the
 * image is loaded once and never re-requested.
 */
export function ImageViewer({ src, alt }: ImageViewerProps) {
  const t = useTranslations('Annotate.viewer');
  const [view, setView] = useState<ViewState>(FIT);
  const [failed, setFailed] = useState(false);
  // Hidden until the bytes arrive, then faded in from the black frame,
  // so moving to the next task visibly changes the image even when two
  // images look alike (fundus photographs do).
  const [loaded, setLoaded] = useState(false);
  // The <img> is server-rendered, so it can finish loading before
  // hydration attaches onLoad; the ref catches that case.
  const imgRef = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, []);
  // The answer form waits for this (#646 review, item 5).
  useReportSampleReady(loaded && !failed);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const helpId = useId();

  const zoomBy = useCallback(
    (factor: number) =>
      setView((v) => {
        const zoom = clamp(v.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        // Back at fit, the image is centred again.
        return zoom === ZOOM_MIN ? { ...v, zoom, x: 0, y: 0 } : { ...v, zoom };
      }),
    [],
  );
  const panBy = useCallback(
    (dx: number, dy: number) =>
      setView((v) => (v.zoom === ZOOM_MIN ? v : { ...v, x: v.x + dx, y: v.y + dy })),
    [],
  );
  const level = useCallback(
    (key: 'brightness' | 'contrast', delta: number) =>
      setView((v) =>
        key === 'brightness'
          ? { ...v, brightness: clamp(v.brightness + delta, LEVEL_MIN, LEVEL_MAX) }
          : { ...v, contrast: clamp(v.contrast + delta, LEVEL_MIN, LEVEL_MAX) },
      ),
    [],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const zoom = zoomOf(e);
      if (zoom !== null) {
        zoomBy(zoom === 1 ? ZOOM_STEP : 1 / ZOOM_STEP);
        e.preventDefault();
        return;
      }
      switch (e.key) {
        case 'f':
        case 'F':
          setView(FIT);
          break;
        case 'i':
        case 'I':
          setView((v) => ({ ...v, invert: !v.invert }));
          break;
        case 'b':
          level('brightness', LEVEL_STEP);
          break;
        case 'B':
          level('brightness', -LEVEL_STEP);
          break;
        case 'c':
          level('contrast', LEVEL_STEP);
          break;
        case 'C':
          level('contrast', -LEVEL_STEP);
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoomBy, level]);

  function onViewportKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [PAN_STEP, 0],
      ArrowRight: [-PAN_STEP, 0],
      ArrowUp: [0, PAN_STEP],
      ArrowDown: [0, -PAN_STEP],
    };
    const move = Object.hasOwn(moves, e.key) ? moves[e.key as keyof typeof moves] : undefined;
    if (!move) return;
    e.preventDefault();
    panBy(move[0], move[1]);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (view.zoom === ZOOM_MIN) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    panBy(e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp() {
    drag.current = null;
  }

  const filter = `${view.invert ? 'invert(1) ' : ''}brightness(${view.brightness}%) contrast(${view.contrast}%)`;
  const toggleInvert = () => setView((v) => ({ ...v, invert: !v.invert }));

  // The toolbar, in display order. Each label names its key; the key
  // handler above maps the same keys to the same actions.
  const controls: ReadonlyArray<ViewControl> = [
    { label: t('fit'), onClick: () => setView(FIT) },
    {
      label: t('zoomOut'),
      onClick: () => zoomBy(1 / ZOOM_STEP),
      disabled: view.zoom <= ZOOM_MIN,
    },
    { label: t('zoomIn'), onClick: () => zoomBy(ZOOM_STEP), disabled: view.zoom >= ZOOM_MAX },
    { label: t('invert'), onClick: toggleInvert, pressed: view.invert },
    { label: t('darker'), onClick: () => level('brightness', -LEVEL_STEP) },
    { label: t('brighter'), onClick: () => level('brightness', LEVEL_STEP) },
    { label: t('lessContrast'), onClick: () => level('contrast', -LEVEL_STEP) },
    { label: t('moreContrast'), onClick: () => level('contrast', LEVEL_STEP) },
  ];

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label={t('toolbar')}
        aria-describedby={helpId}
        className="flex flex-wrap items-center gap-1.5"
      >
        {controls.map((c) => (
          <Button
            key={c.label}
            type="button"
            size="sm"
            variant="secondary"
            onClick={c.onClick}
            disabled={c.disabled}
            aria-pressed={c.pressed}
          >
            {c.label}
          </Button>
        ))}
      </div>
      {/* Fixed text: the live values sit on the image instead, so
          changing them never reflows the page. */}
      <p id={helpId} className="text-xs text-[var(--color-muted-foreground)]">
        {t('help')}
      </p>
      <div
        role="region"
        aria-label={t('region')}
        tabIndex={0}
        onKeyDown={onViewportKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative h-[60vh] min-h-72 overflow-hidden rounded-md bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ${view.zoom > ZOOM_MIN ? 'cursor-grab touch-none' : ''}`}
      >
        {failed ? (
          <p
            role="alert"
            className="absolute inset-0 grid place-items-center p-4 text-sm text-white"
          >
            {t('failed')}
          </p>
        ) : (
          // A plain <img>: the address is a short-lived signed URL on the
          // storage host, which next/image would try to re-fetch and cache.
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`h-full w-full select-none object-contain transition-opacity duration-500 ease-out motion-reduce:transition-none ${loaded ? 'opacity-100' : 'opacity-0'}`}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              filter,
            }}
          />
        )}
        {!failed && !loaded ? (
          <p
            role="status"
            className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white"
          >
            {t('loading')}
          </p>
        ) : null}
        {/* Current settings, overlaid so they take no layout space. All
            four are always shown and the numbers have a fixed width, so
            the pills never change size as the values change. */}
        <ul
          aria-label={t('settings')}
          className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-1.5 font-mono text-xs tabular-nums"
        >
          <ViewPill label={t('zoom')} value={`${Math.round(view.zoom * 100)}%`} />
          <ViewPill label={t('brightness')} value={`${view.brightness}%`} />
          <ViewPill label={t('contrast')} value={`${view.contrast}%`} />
          <ViewPill label={t('invertPill')} value={view.invert ? t('on') : t('off')} />
        </ul>
      </div>
    </div>
  );
}

/** One setting on the image overlay; the value keeps a fixed width (up to "800%"). */
function ViewPill({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded bg-black/70 px-2 py-0.5 text-white">
      {label} <span className="inline-block min-w-[4ch] text-right">{value}</span>
    </li>
  );
}
