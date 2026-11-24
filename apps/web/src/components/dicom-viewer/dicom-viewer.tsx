'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Enums,
  RenderingEngine,
  cache,
  init as coreInit,
  imageLoader,
  type Types,
} from '@cornerstonejs/core';
import { init as dicomImageLoaderInit, wadouri } from '@cornerstonejs/dicom-image-loader';
import { Enums as MetadataEnums, metaData } from '@cornerstonejs/metadata';
import { useTranslations } from 'next-intl';
import type { DicomView, DicomViewerSeries } from '@oci/shared-types';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import {
  CT_PRESETS,
  PAN_STEP,
  ZOOM_STEP,
  actionForKey,
  clampIndex,
  classifyLoadFailure,
  currentView,
  describeTransferSyntax,
  dragWindow,
  firstRefusedEncoding,
  exactFromVoiRange,
  fromVoiRange,
  matchingPreset,
  mergeRefreshedAddresses,
  nextToLoad,
  sameInstances,
  sameView,
  toVoiRange,
  usableLifetimeMs,
  wheelSteps,
  type CtPreset,
  type ViewerAction,
  type WindowSetting,
} from './viewer-logic';

/**
 * The platform's built-in DICOM viewer (ADR-0026): one stack of
 * single-frame images, read-only.
 *
 * It displays and never produces. There is nothing here that draws,
 * measures or saves: anything that does goes to an external tool
 * through the tool-integration contract. What a reader can do is
 * scroll the stack, set the window, zoom, move, invert and reset, with
 * the mouse, with the keyboard, or with the controls under the image.
 *
 * The files are fetched by the browser from storage, with the signed
 * addresses `loadSeries` returns. Those addresses are short-lived. The
 * whole stack is fetched up front so that scrolling is instant, and
 * when the addresses run out before that is done, `loadSeries` is
 * called again and the images still missing take the new ones.
 *
 * No `@cornerstonejs/tools`: its compute worker does not survive the
 * production build, and a read-only stack needs four gestures that are
 * a few lines each against the core viewport.
 */
export interface DicomViewerProps {
  /**
   * Fetches the series: its instances in display order, each with a
   * fresh storage address. Called on mount, and again when addresses
   * expire. Keep its identity stable (`useCallback`) or the viewer
   * restarts. The dataset page passes a series from the dataset's
   * endpoint; a task screen passes its `dicom-series` sample. Both fit.
   */
  loadSeries: () => Promise<DicomViewerSeries>;
  /** Names the image for assistive technology, e.g. "CT series 3". */
  label: string;
  /**
   * Told what the reader has on screen each time it changes: the image
   * drawn, its place in the stack, the window and inversion. Null while
   * the picture is not the image asked for. An answer form stores the
   * last one as the answer's `view`.
   */
  onViewChange?: (view: DicomView | null) => void;
  /**
   * Where the viewer is shown, for what a message tells the reader to do
   * next. On the dataset page they can close the viewer and download the
   * files; on a task screen they can do neither, and skip the task
   * instead. Defaults to the dataset page.
   */
  context?: DicomViewerContext;
}

export type DicomViewerContext = 'dataset' | 'task';

type Phase = 'starting' | 'ready' | 'failed';

/**
 * Why the viewer gave up, as data: the words are chosen at render time,
 * in the interface language, so the effect that loads the series does
 * not depend on the language.
 */
type Failure =
  | { kind: 'empty' }
  | { kind: 'decoder'; position: number; transferSyntaxUid: string | null }
  /** Decodable, but drawn wrong (#778): refused before anything is fetched. */
  | { kind: 'refused'; position: number; transferSyntaxUid: string | null }
  | { kind: 'open'; reason: 'address' | 'other' }
  | { kind: 'changed' }
  | { kind: 'start' };

type Translate = ReturnType<typeof useTranslations<'DicomViewer'>>;

function failureText(
  t: Translate,
  failure: Failure,
  context: DicomViewerContext,
): { title: string; detail: string } {
  switch (failure.kind) {
    case 'empty':
      return { title: t('failure.emptyTitle'), detail: t('failure.emptyDetail') };
    case 'decoder':
      return {
        title: t('failure.decoderTitle'),
        detail: t('failure.decoderDetail', {
          context,
          position: failure.position + 1,
          syntax:
            failure.transferSyntaxUid === null
              ? t('failure.transferSyntaxUnknown')
              : describeTransferSyntax(failure.transferSyntaxUid),
        }),
      };
    case 'refused':
      return {
        title: t('failure.refusedTitle'),
        detail: t('failure.refusedDetail', {
          context,
          position: failure.position + 1,
          syntax:
            failure.transferSyntaxUid === null
              ? t('failure.transferSyntaxUnknown')
              : describeTransferSyntax(failure.transferSyntaxUid),
        }),
      };
    case 'open':
      return {
        title: t('failure.openTitle'),
        detail: failure.reason === 'address' ? t('failure.openAddress') : t('failure.openNetwork'),
      };
    case 'changed':
      return { title: t('failure.changedTitle'), detail: t('failure.changedDetail', { context }) };
    case 'start':
      return { title: t('failure.startTitle'), detail: t('failure.startDetail', { context }) };
  }
}

/** The label of a CT preset, by its id; an unknown preset keeps its own label. */
function presetLabel(t: Translate, preset: CtPreset): string {
  switch (preset.id) {
    case 'brain':
    case 'subdural':
    case 'bone':
    case 'lung':
    case 'mediastinum':
      return t(`presets.${preset.id}`);
    default:
      return preset.label;
  }
}

/** Fetches of the rest of the stack that run side by side. */
const PREFETCH_CONCURRENCY = 6;
/** Ask for new addresses this long before the current ones run out. */
const REFRESH_MARGIN_MS = 30_000;
/** A reader who keeps hitting refused addresses is not helped by a fourth try. */
const MAX_REFRESHES = 3;

let initialised: Promise<void> | null = null;
/** Cornerstone and its decode workers are set up once per page. */
function initOnce(): Promise<void> {
  initialised ??= (async () => {
    await coreInit();
    dicomImageLoaderInit({ maxWebWorkers: Math.min(4, navigator.hardwareConcurrency || 2) });
  })();
  return initialised;
}

const imageIdOf = (instance: { url: string }): string => `wadouri:${instance.url}`;

let openViewers = 0;
/**
 * Lets go of every file and decoded image once the last viewer on the
 * page closes. The library keeps them in three places, all keyed by
 * the address a file came from: the decoded pixels, the parsed file,
 * and the file's content again beside its metadata. Those addresses
 * are signed anew each time a series is opened, so nothing kept would
 * ever be used again, and a few large series would fill the tab.
 */
function releaseImages(): void {
  if (openViewers > 0) return;
  const release = (step: () => void) => {
    try {
      step();
    } catch {
      // Nothing there to release.
    }
  };
  release(() => cache.purgeCache());
  release(() => wadouri.dataSetCacheManager.purge());
  for (const type of Object.values(MetadataEnums.MetadataModules)) {
    release(() => metaData.clear(type));
  }
}

export function DicomViewer({
  loadSeries,
  label,
  onViewChange,
  context = 'dataset',
}: DicomViewerProps) {
  const t = useTranslations('DicomViewer');
  const reactId = useId();
  const helpId = `${reactId}-help`;
  const elementRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Types.IStackViewport | null>(null);
  /** Goes to an image of the stack. Set while a series is open. */
  const goToRef = useRef<((target: number) => void) | null>(null);
  /** The image asked for, kept outside React state: a burst of key presses outruns it. */
  const currentRef = useRef(0);
  const countRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('starting');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [count, setCount] = useState(0);
  /** The distribution of each image, in stack order. */
  const [distributionIds, setDistributionIds] = useState<readonly string[]>([]);
  /** The image asked for. */
  const [index, setIndex] = useState(0);
  /** The image the canvas really shows. Behind `index` while one loads. */
  const [drawnIndex, setDrawnIndex] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  /** Positions in the stack whose image could not be loaded. */
  const [failedPositions, setFailedPositions] = useState<ReadonlySet<number>>(new Set());
  const [modality, setModality] = useState<string | null>(null);
  const [windowSetting, setWindowSetting] = useState<WindowSetting | null>(null);
  const [inverted, setInverted] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let cancelled = false;
    let engine: RenderingEngine | null = null;
    openViewers += 1;
    const removers: Array<() => void> = [];
    const listen = <K extends string>(
      target: EventTarget,
      type: K,
      handler: (event: never) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler as EventListener, options);
      removers.push(() => target.removeEventListener(type, handler as EventListener, options));
    };

    const fail = (why: Failure) => {
      if (cancelled) return;
      setFailure(why);
      setPhase('failed');
    };

    const run = async () => {
      await initOnce();
      let series = await loadSeries();
      if (cancelled) return;
      if (series.instances.length === 0) {
        fail({ kind: 'empty' });
        return;
      }

      let imageIds = series.instances.map(imageIdOf);
      /** Positions in the stack whose image is loaded. */
      const loaded = new Set<number>();
      /** Positions whose image could not be loaded. */
      const failed = new Set<number>();
      countRef.current = imageIds.length;
      setCount(imageIds.length);
      // Renewed addresses never change these: a renewal whose
      // instances differ stops the viewer.
      setDistributionIds(series.instances.map((instance) => instance.distributionId));
      setModality(series.modality);

      const failDecoder = (position: number) =>
        fail({
          kind: 'decoder',
          position,
          transferSyntaxUid: series.instances.at(position)?.transferSyntaxUid ?? null,
        });

      // Refused before anything is fetched: this encoding decodes, but
      // into a picture that is wrong and looks right (#778).
      const refused = firstRefusedEncoding(series.instances);
      if (refused !== null) {
        fail({
          kind: 'refused',
          position: refused,
          transferSyntaxUid: series.instances.at(refused)?.transferSyntaxUid ?? null,
        });
        return;
      }

      // --- addresses -----------------------------------------------
      // When to renew, on the reader's own monotonic clock.
      const deadlineOf = (detail: DicomViewerSeries): number => {
        const lifetime = usableLifetimeMs(detail.expiresAt, Date.now());
        return lifetime === null ? Number.POSITIVE_INFINITY : performance.now() + lifetime;
      };
      let deadline = deadlineOf(series);

      // --- first image ---------------------------------------------
      // Loaded through the loader, not through the viewport: the
      // viewport swallows a failed load and would show a black box as
      // if it were an image.
      const loadFirst = async (retried = false): Promise<boolean> => {
        const id = imageIds.at(0);
        if (id === undefined) return false;
        try {
          await imageLoader.loadAndCacheImage(id);
          return !cancelled;
        } catch (error) {
          if (cancelled) return false;
          const why = classifyLoadFailure(error);
          if (why === 'decoder') {
            failDecoder(0);
            return false;
          }
          if (why === 'address' && !retried) {
            const fresh = await loadSeries().catch(() => null);
            if (cancelled) return false;
            if (fresh && sameInstances(series.instances, fresh.instances)) {
              series = fresh;
              imageIds = fresh.instances.map(imageIdOf);
              deadline = deadlineOf(fresh);
              return loadFirst(true);
            }
          }
          fail({ kind: 'open', reason: why === 'address' ? 'address' : 'other' });
          return false;
        }
      };
      if (!(await loadFirst())) return;
      loaded.add(0);

      // Each engine and viewport needs an id of its own: two viewers
      // can be on one page.
      engine = new RenderingEngine(`dicom-engine-${reactId}`);
      const viewportId = `dicom-stack-${reactId}`;
      engine.enableElement({ viewportId, type: Enums.ViewportType.STACK, element });
      const viewport = engine.getViewport(viewportId) as Types.IStackViewport;
      viewportRef.current = viewport;

      let current = 0;
      let drawn = 0;
      const goTo = (target: number) => {
        current = clampIndex(target, imageIds.length);
        currentRef.current = current;
        setIndex(current);
        // An image that could not be loaded is not asked for again: the
        // viewport would keep the previous picture and say nothing. The
        // screen says which image is missing instead.
        if (!failed.has(current)) void viewport.setImageIdIndex(current).catch(() => undefined);
      };

      listen(element, Enums.Events.STACK_NEW_IMAGE, (event: CustomEvent) => {
        const detail = event.detail as { imageIdIndex?: number };
        if (typeof detail.imageIdIndex !== 'number') return;
        drawn = detail.imageIdIndex;
        setDrawnIndex(drawn);
      });
      listen(element, Enums.Events.VOI_MODIFIED, (event: CustomEvent) => {
        const detail = event.detail as {
          range?: { lower: number; upper: number };
          invert?: boolean;
        };
        if (detail.range) setWindowSetting(fromVoiRange(detail.range));
        if (typeof detail.invert === 'boolean') setInverted(detail.invert);
      });

      // --- gestures ------------------------------------------------
      // The window being dragged is kept exact for the length of the
      // drag. Reading it back from the screen's whole numbers on every
      // event would cancel slow movements in one direction.
      let drag: { button: number; x: number; y: number; window: WindowSetting | null } | null =
        null;
      listen(element, 'pointerdown', (event: PointerEvent) => {
        drag = { button: event.button, x: event.clientX, y: event.clientY, window: null };
        element.setPointerCapture(event.pointerId);
        element.focus({ preventScroll: true });
      });
      listen(element, 'pointermove', (event: PointerEvent) => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (drag.button === 1 || (drag.button === 0 && event.shiftKey)) {
          const [x, y] = viewport.getPan();
          viewport.setPan([x + dx, y + dy]);
        } else if (drag.button === 2) {
          viewport.setZoom(Math.max(0.1, viewport.getZoom() * (1 - dy * 0.01)));
        } else if (drag.button === 0) {
          const range = viewport.getProperties().voiRange;
          if (!range) return;
          drag.window = dragWindow(drag.window ?? exactFromVoiRange(range), dx, dy);
          viewport.setProperties({ voiRange: toVoiRange(drag.window) });
        }
        viewport.render();
      });
      const endDrag = () => {
        drag = null;
      };
      listen(element, 'pointerup', endDrag);
      listen(element, 'pointercancel', endDrag);
      listen(element, 'contextmenu', (event: Event) => event.preventDefault());
      let wheelCarry = 0;
      listen(
        element,
        'wheel',
        (event: WheelEvent) => {
          event.preventDefault();
          const turned = wheelSteps(wheelCarry, event.deltaY, event.deltaMode);
          wheelCarry = turned.carried;
          if (turned.steps !== 0) goTo(current + turned.steps);
        },
        { passive: false },
      );

      // The canvas follows its box: the dialog it sits in resizes with
      // the window.
      const resizer = new ResizeObserver(() => engine?.resize(true, true));
      resizer.observe(element);
      removers.push(() => resizer.disconnect());

      let refreshes = 0;
      let refreshing: Promise<boolean> | null = null;
      /**
       * New addresses for the images not loaded yet. False when that
       * could not be done; the images already shown stay as they are.
       */
      const refresh = (): Promise<boolean> => {
        refreshing ??= (async () => {
          if (refreshes >= MAX_REFRESHES) return false;
          refreshes += 1;
          // A failed renewal (the session ran out, the network blinked)
          // must not take away what is already on screen.
          const fresh = await loadSeries().catch(() => null);
          if (cancelled || !fresh) return false;
          if (!sameInstances(series.instances, fresh.instances)) {
            fail({ kind: 'changed' });
            return false;
          }
          series = fresh;
          deadline = deadlineOf(fresh);
          imageIds = mergeRefreshedAddresses(imageIds, loaded, fresh.instances.map(imageIdOf));
          // The stack takes the new addresses; what the reader was
          // looking at, and how, stays. It restarts on the image that
          // is drawn, which is loaded and so kept its address.
          const { voiRange, invert } = viewport.getProperties();
          const zoom = viewport.getZoom();
          const pan = viewport.getPan();
          await viewport.setStack(imageIds, drawn);
          if (cancelled) return false;
          viewport.setProperties({ voiRange, invert });
          viewport.setZoom(zoom);
          viewport.setPan(pan);
          viewport.render();
          if (current !== drawn) goTo(current);
          return true;
        })().finally(() => {
          refreshing = null;
        });
        return refreshing;
      };

      await viewport.setStack(imageIds, 0);
      if (cancelled) return;
      viewport.render();
      goToRef.current = goTo;
      setLoadedCount(1);
      setPhase('ready');

      // --- the rest of the stack -----------------------------------
      // Nearest the image on screen first, not in stack order: on a slow
      // link a reader who jumps ahead finds the neighbours there.
      /** Positions loaded, failed or being fetched. */
      const taken = new Set<number>([0]);
      const loadOne = async (i: number, retried = false): Promise<void> => {
        // Renewed ahead of time when the time is known; if that fails,
        // the load goes ahead with the address there is.
        if (performance.now() > deadline - REFRESH_MARGIN_MS) await refresh();
        const id = imageIds.at(i);
        if (id === undefined || cancelled) return;
        try {
          await imageLoader.loadAndCacheImage(id);
          loaded.add(i);
          if (!cancelled) setLoadedCount((n) => n + 1);
        } catch (error) {
          if (cancelled) return;
          const why = classifyLoadFailure(error);
          if (why === 'decoder') return failDecoder(i);
          if (why === 'address' && !retried && (await refresh())) return loadOne(i, true);
          failed.add(i);
          setFailedPositions(new Set(failed));
        }
      };
      const worker = async () => {
        while (!cancelled) {
          const i = nextToLoad(current, imageIds.length, taken);
          if (i === null) return;
          taken.add(i);
          await loadOne(i);
        }
      };
      await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
    };

    run().catch(() => {
      fail({ kind: 'start' });
    });

    return () => {
      cancelled = true;
      for (const remove of removers) remove();
      goToRef.current = null;
      viewportRef.current = null;
      engine?.destroy();
      openViewers -= 1;
      releaseImages();
    };
  }, [loadSeries, reactId]);

  const perform = useCallback((action: ViewerAction) => {
    const goTo = goToRef.current;
    const viewport = viewportRef.current;
    if (!goTo || !viewport) return;
    switch (action.type) {
      case 'step':
        goTo(currentRef.current + action.delta);
        return;
      case 'goto':
        goTo(action.index);
        return;
      case 'first':
        goTo(0);
        return;
      case 'last':
        goTo(countRef.current - 1);
        return;
      case 'zoom':
        viewport.setZoom(Math.max(0.1, viewport.getZoom() * action.factor));
        break;
      case 'pan': {
        const [x, y] = viewport.getPan();
        viewport.setPan([x + action.dx, y + action.dy]);
        break;
      }
      case 'invert': {
        const invert = !viewport.getProperties().invert;
        viewport.setProperties({ invert });
        setInverted(invert);
        break;
      }
      case 'reset':
        viewport.resetCamera();
        viewport.resetProperties();
        setInverted(false);
        break;
    }
    viewport.render();
  }, []);

  const applyWindow = useCallback((setting: WindowSetting) => {
    const viewport = viewportRef.current;
    if (!viewport || !(setting.width >= 1) || !Number.isFinite(setting.center)) return;
    viewport.setProperties({ voiRange: toVoiRange(setting) });
    viewport.render();
    setWindowSetting({ width: Math.round(setting.width), center: Math.round(setting.center) });
  }, []);

  const ready = phase === 'ready';
  const activePreset = matchingPreset(windowSetting);
  const missingCount = failedPositions.size;
  const allLoaded = ready && loadedCount + missingCount >= count;
  // What stands in for the picture when the image asked for is not the
  // one drawn: the previous image must never pass for this one.
  const standIn = !ready
    ? null
    : failedPositions.has(index)
      ? t('standInFailed', { index: index + 1 })
      : drawnIndex !== index
        ? t('standInLoading', { index: index + 1 })
        : null;
  const failureMessage = failure ? failureText(t, failure, context) : null;

  const view =
    ready && !failure
      ? currentView({
          distributionIds,
          index,
          drawnIndex,
          failed: failedPositions,
          window: windowSetting,
          inverted,
        })
      : null;
  // Told once per change, not once per render.
  const reportedView = useRef<DicomView | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  }, [onViewChange]);
  useEffect(() => {
    if (sameView(reportedView.current, view)) return;
    reportedView.current = view;
    onViewChangeRef.current?.(view);
  });

  return (
    <div className="space-y-3">
      {failureMessage ? (
        <Alert tone="danger">
          <AlertTitle as="h3">{failureMessage.title}</AlertTitle>
          <AlertDescription>{failureMessage.detail}</AlertDescription>
        </Alert>
      ) : null}

      {/* Black whatever the theme, and white text on it: a radiological
          image is read on black. These are the only colours here that
          are not design tokens, on purpose. */}
      <div className={failure ? 'hidden' : 'relative overflow-hidden rounded-md bg-black'}>
        <div
          ref={elementRef}
          tabIndex={0}
          role="application"
          aria-roledescription={t('roleDescription')}
          aria-label={
            ready
              ? t('viewportLabel', { label, index: index + 1, count })
              : t('viewportLabelLoading', { label })
          }
          aria-describedby={helpId}
          data-testid="dicom-viewport"
          data-view={view ? JSON.stringify(view) : undefined}
          onKeyDown={(event) => {
            const action = actionForKey(event.key, event.shiftKey, event.code);
            if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            perform(action);
          }}
          className="h-[min(calc(100dvh-24rem),44rem)] min-h-64 w-full touch-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        />
        {ready ? (
          <>
            {standIn ? (
              <p
                data-testid="dicom-stand-in"
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black px-4 text-center text-sm text-white"
              >
                {standIn}
              </p>
            ) : null}
            <p
              data-testid="dicom-counter"
              className="pointer-events-none absolute start-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-sm text-white"
            >
              {index + 1} / {count}
            </p>
            {windowSetting ? (
              <p
                data-testid="dicom-window"
                className="pointer-events-none absolute end-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-sm text-white"
              >
                {t('windowReadout', {
                  width: windowSetting.width,
                  center: windowSetting.center,
                })}
              </p>
            ) : null}
            {!allLoaded ? (
              <p
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2 start-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-xs text-white"
              >
                {t('loadingProgress', { loaded: loadedCount, count })}
              </p>
            ) : null}
          </>
        ) : (
          <p
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white"
            aria-hidden="true"
          >
            {t('opening')}
          </p>
        )}
      </div>

      {/* Said once, not once per image. */}
      <p role="status" className="sr-only" data-testid="dicom-status">
        {failure
          ? ''
          : !ready
            ? t('status.opening')
            : allLoaded
              ? missingCount > 0
                ? t('status.someMissing', { loaded: loadedCount, count, missing: missingCount })
                : t('status.allLoaded', { count })
              : t('status.loading')}
      </p>
      {ready && allLoaded && missingCount > 0 ? (
        <Alert tone="warning">
          <AlertDescription>
            {t('missingAlert', { context, missing: missingCount, count })}
          </AlertDescription>
        </Alert>
      ) : null}

      {!failure ? (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <span className="shrink-0 font-medium">{t('image')}</span>
            <input
              type="range"
              min={1}
              max={Math.max(1, count)}
              step={1}
              value={index + 1}
              disabled={!ready || count < 2}
              aria-valuetext={t('imageValueText', { index: index + 1, count })}
              onChange={(event) => perform({ type: 'goto', index: Number(event.target.value) - 1 })}
              data-testid="dicom-slider"
              className="h-11 min-w-0 flex-1 accent-[var(--color-primary)] sm:h-6"
            />
          </label>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <fieldset disabled={!ready} className="min-w-0 space-y-1">
              <legend className="text-xs font-medium text-[var(--color-muted-foreground)]">
                {t('window')}
              </legend>
              <div className="flex flex-wrap items-center gap-2">
                {modality === 'CT'
                  ? CT_PRESETS.map((preset) => (
                      <Button
                        key={preset.id}
                        type="button"
                        size="sm"
                        variant={activePreset?.id === preset.id ? 'primary' : 'secondary'}
                        aria-pressed={activePreset?.id === preset.id}
                        onClick={() => applyWindow(preset)}
                        className="h-11 sm:h-8"
                      >
                        {presetLabel(t, preset)}
                      </Button>
                    ))
                  : null}
                <WindowNumber
                  name="width"
                  label={t('width')}
                  value={windowSetting?.width ?? null}
                  min={1}
                  onCommit={(width) => applyWindow({ width, center: windowSetting?.center ?? 0 })}
                />
                <WindowNumber
                  name="level"
                  label={t('level')}
                  signed
                  value={windowSetting?.center ?? null}
                  onCommit={(center) => applyWindow({ width: windowSetting?.width ?? 1, center })}
                />
              </div>
            </fieldset>

            <fieldset disabled={!ready} className="min-w-0 space-y-1">
              <legend className="text-xs font-medium text-[var(--color-muted-foreground)]">
                {t('view')}
              </legend>
              <div className="flex flex-wrap items-center gap-2">
                <ViewButton
                  label={t('zoomOut')}
                  onClick={() => perform({ type: 'zoom', factor: 1 / ZOOM_STEP })}
                >
                  −
                </ViewButton>
                <ViewButton
                  label={t('zoomIn')}
                  onClick={() => perform({ type: 'zoom', factor: ZOOM_STEP })}
                >
                  +
                </ViewButton>
                <ViewButton
                  label={t('moveLeft')}
                  onClick={() => perform({ type: 'pan', dx: -PAN_STEP, dy: 0 })}
                >
                  ←
                </ViewButton>
                <ViewButton
                  label={t('moveUp')}
                  onClick={() => perform({ type: 'pan', dx: 0, dy: -PAN_STEP })}
                >
                  ↑
                </ViewButton>
                <ViewButton
                  label={t('moveDown')}
                  onClick={() => perform({ type: 'pan', dx: 0, dy: PAN_STEP })}
                >
                  ↓
                </ViewButton>
                <ViewButton
                  label={t('moveRight')}
                  onClick={() => perform({ type: 'pan', dx: PAN_STEP, dy: 0 })}
                >
                  →
                </ViewButton>
                <Button
                  type="button"
                  size="sm"
                  variant={inverted ? 'primary' : 'secondary'}
                  aria-pressed={inverted}
                  onClick={() => perform({ type: 'invert' })}
                  className="h-11 sm:h-8"
                >
                  {t('invert')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => perform({ type: 'reset' })}
                  className="h-11 sm:h-8"
                >
                  {t('reset')}
                </Button>
              </div>
            </fieldset>
          </div>

          {/* Folded by default, so the image keeps the height. Still read
              out as the description of the image: `aria-describedby`
              reaches content that is not displayed. */}
          <details className="text-xs text-[var(--color-muted-foreground)]">
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:min-h-6">
              {t('help.summary')}
            </summary>
            <div id={helpId} className="mt-1 space-y-1">
              <p className="max-w-prose">
                {t.rich('help.mouse', {
                  strong: (chunks) => <span className="font-medium">{chunks}</span>,
                })}
              </p>
              <p className="max-w-prose">
                {t.rich('help.keyboard', {
                  strong: (chunks) => <span className="font-medium">{chunks}</span>,
                })}
              </p>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function ViewButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-11 w-11 px-0 text-base sm:h-8 sm:w-8"
    >
      <span aria-hidden="true">{children}</span>
    </Button>
  );
}

/**
 * Window width or level as a number: the way to set the window without
 * dragging. The field shows the live value, and takes a typed one on
 * Enter or when it loses focus.
 */
function WindowNumber({
  name,
  label,
  value,
  min,
  signed = false,
  onCommit,
}: {
  /** Stable id of the field (`width`, `level`); also its test id. */
  name: 'width' | 'level';
  /** The field's visible name, in the interface language. */
  label: string;
  value: number | null;
  min?: number;
  /** The value can be negative: a level often is (lung is -600). */
  signed?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed) && (min === undefined || parsed >= min)) {
      onCommit(parsed);
    }
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <input
        type="number"
        // The digits-only keypad of a phone or tablet has no minus key.
        inputMode={signed ? undefined : 'numeric'}
        min={min}
        step={1}
        value={draft ?? (value === null ? '' : String(value))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        data-testid={`dicom-window-${name}`}
        className="h-11 w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 font-mono text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:h-8"
      />
    </label>
  );
}
