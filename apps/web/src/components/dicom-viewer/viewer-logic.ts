/**
 * The parts of the DICOM viewer that need no browser and no rendering
 * library: window arithmetic, the keyboard map, what a failed load
 * means, and how fresh storage addresses are merged into a stack that
 * is partly loaded (ADR-0026). Kept apart so they are unit-tested.
 */

import type { DicomView } from '@oci/shared-types';

/** A display window: its width and its centre (level). */
export interface WindowSetting {
  width: number;
  center: number;
}

export interface CtPreset extends WindowSetting {
  id: string;
  label: string;
}

/**
 * CT presets, in Hounsfield units. They are only offered for CT: on
 * any other modality the numbers mean nothing.
 */
export const CT_PRESETS: readonly CtPreset[] = [
  { id: 'brain', label: 'Brain', width: 80, center: 40 },
  { id: 'subdural', label: 'Subdural', width: 200, center: 75 },
  { id: 'bone', label: 'Bone', width: 2000, center: 500 },
  { id: 'lung', label: 'Lung', width: 1500, center: -600 },
  { id: 'mediastinum', label: 'Mediastinum', width: 350, center: 50 },
];

/**
 * A window as the range of stored values it spans. The arithmetic is
 * DICOM's own (PS3.3 C.11.2.1.2): a window of width 80 centred on 40
 * runs from 0 to 79, not from 0 to 80. Using the same definition as
 * the files means a preset of 80 / 40 and a file that proposes 80 / 40
 * are one and the same window, and read the same on screen.
 */
export function toVoiRange(setting: WindowSetting): { lower: number; upper: number } {
  return {
    lower: setting.center - 0.5 - (setting.width - 1) / 2,
    upper: setting.center - 0.5 + (setting.width - 1) / 2,
  };
}

/** The window a range is, to the fraction. For arithmetic, not for display. */
export function exactFromVoiRange(range: { lower: number; upper: number }): WindowSetting {
  return {
    width: range.upper - range.lower + 1,
    center: (range.upper + range.lower + 1) / 2,
  };
}

/** The window a range is, in whole numbers, as it is shown. */
export function fromVoiRange(range: { lower: number; upper: number }): WindowSetting {
  const exact = exactFromVoiRange(range);
  return { width: Math.round(exact.width), center: Math.round(exact.center) };
}

/** The preset a window corresponds to, if it is exactly one of them. */
export function matchingPreset(setting: WindowSetting | null): CtPreset | null {
  if (!setting) return null;
  return (
    CT_PRESETS.find(
      (preset) => preset.width === setting.width && preset.center === setting.center,
    ) ?? null
  );
}

/**
 * A drag over the image: right widens the window, down raises the
 * level. The step grows with the window, so a narrow brain window is
 * adjusted finely and a bone window does not take a metre of mouse.
 */
export function dragWindow(current: WindowSetting, dx: number, dy: number): WindowSetting {
  const step = Math.max(0.5, current.width / 200);
  return {
    width: Math.max(1, current.width + dx * step),
    center: current.center + dy * step,
  };
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(index)));
}

/**
 * The next image to fetch: the one nearest the image on screen that is
 * neither loaded nor being fetched, after it first and then before it,
 * one step further each time. A reader who jumps into a series that is
 * still arriving then finds its neighbours there, where loading in
 * stack order would only reach them last. Null when nothing is left.
 */
export function nextToLoad(
  current: number,
  count: number,
  taken: ReadonlySet<number>,
): number | null {
  if (count <= 0) return null;
  const from = clampIndex(current, count);
  for (let distance = 0; distance < count; distance += 1) {
    const after = from + distance;
    if (after < count && !taken.has(after)) return after;
    const before = from - distance;
    if (distance > 0 && before >= 0 && !taken.has(before)) return before;
  }
  return null;
}

export const ZOOM_STEP = 1.2;
/** Screen pixels moved by one press of an arrow with Shift, or one move button. */
export const PAN_STEP = 24;

export type ViewerAction =
  | { type: 'step'; delta: number }
  | { type: 'goto'; index: number }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'zoom'; factor: number }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'invert' }
  | { type: 'reset' };

/**
 * What a key does while the image has focus. Everything the mouse can
 * do has a key here or a control beside the image.
 */
export function actionForKey(
  key: string,
  shiftKey: boolean,
  /**
   * The physical key, when known. A key on the digit row never zooms:
   * a French (AZERTY) keyboard puts - on the 6 key and _ on the 8 key,
   * which pick labels on a task screen (#646 review).
   */
  code?: string,
): ViewerAction | null {
  const onDigitRow = code?.startsWith('Digit') ?? false;
  if (shiftKey) {
    switch (key) {
      case 'ArrowLeft':
        return { type: 'pan', dx: -PAN_STEP, dy: 0 };
      case 'ArrowRight':
        return { type: 'pan', dx: PAN_STEP, dy: 0 };
      case 'ArrowUp':
        return { type: 'pan', dx: 0, dy: -PAN_STEP };
      case 'ArrowDown':
        return { type: 'pan', dx: 0, dy: PAN_STEP };
      default:
        break;
    }
  }
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return { type: 'step', delta: 1 };
    case 'ArrowUp':
    case 'ArrowLeft':
      return { type: 'step', delta: -1 };
    case 'PageDown':
      return { type: 'step', delta: 10 };
    case 'PageUp':
      return { type: 'step', delta: -10 };
    case 'Home':
      return { type: 'first' };
    case 'End':
      return { type: 'last' };
    case '+':
    case '=':
      return onDigitRow ? null : { type: 'zoom', factor: ZOOM_STEP };
    case '-':
    case '_':
      return onDigitRow ? null : { type: 'zoom', factor: 1 / ZOOM_STEP };
    case 'i':
    case 'I':
      return { type: 'invert' };
    case 'r':
    case 'R':
      return { type: 'reset' };
    default:
      return null;
  }
}

/** How far a trackpad has to travel, in pixels, to move one image. */
const WHEEL_PIXELS_PER_IMAGE = 40;

/**
 * Turns wheel movement into whole images.
 *
 * One notch of a mouse wheel is one image, never more: a reader who
 * steps through a stack must not have a slice skipped for them.
 * Browsers report a notch as a large pixel delta (100 in Chromium) or
 * as lines or pages, and any of those is one step. A trackpad sends
 * many small deltas instead: those are summed, the remainder is kept
 * for the next event, and it is dropped when the direction changes.
 */
export function wheelSteps(
  carried: number,
  deltaY: number,
  deltaMode: number,
): { steps: number; carried: number } {
  if (deltaY === 0) return { steps: 0, carried };
  const direction = Math.sign(deltaY);
  // deltaMode 0 is pixels; 1 is lines and 2 is pages.
  if (deltaMode !== 0 || Math.abs(deltaY) >= WHEEL_PIXELS_PER_IMAGE) {
    return { steps: direction, carried: 0 };
  }
  const total = (Math.sign(carried) === direction ? carried : 0) + deltaY;
  // `+ 0` turns the -0 of a small upward movement into 0.
  const steps = Math.trunc(total / WHEEL_PIXELS_PER_IMAGE) + 0;
  return { steps, carried: total - steps * WHEEL_PIXELS_PER_IMAGE };
}

/** Longest a storage address is ever signed for, with a margin. */
const MAX_ADDRESS_LIFETIME_MS = 16 * 60_000;

/**
 * How long the addresses of a series are still good for, by the
 * reader's own clock, or null when that cannot be told.
 *
 * `expiresAt` is the server's time. A reader whose clock is off by
 * minutes would see addresses that have "already expired" or that last
 * for hours. Neither is believed: null means nothing is renewed ahead
 * of time, and a refused address still triggers a renewal.
 */
export function usableLifetimeMs(expiresAt: string, now: number): number | null {
  const lifetime = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(lifetime)) return null;
  return lifetime > 60_000 && lifetime <= MAX_ADDRESS_LIFETIME_MS ? lifetime : null;
}

/**
 * Why an image did not load.
 *
 *  - `address`  storage refused the signed address (it expired, or the
 *               file is no longer served to this reader). Asking for the
 *               series again may fix it.
 *  - `decoder`  the file arrived and its compression is one the viewer
 *               has no decoder for. Asking again will not fix it.
 *  - `network`  the request never completed.
 *  - `other`    anything else.
 */
export type LoadFailure = 'address' | 'decoder' | 'network' | 'other';

export function classifyLoadFailure(error: unknown): LoadFailure {
  // The image loader rejects with the XMLHttpRequest itself when the
  // request fails, and with an Error when decoding does.
  const status = statusOf(error);
  if (status === 401 || status === 403) return 'address';
  if (status === 0) return 'network';
  const message = messageOf(error);
  if (/no decoder for transfer syntax/i.test(message)) return 'decoder';
  if (/network|failed to fetch/i.test(message)) return 'network';
  return 'other';
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  for (const holder of [error, Reflect.get(error, 'request'), Reflect.get(error, 'xhr')]) {
    if (holder && typeof holder === 'object') {
      const status: unknown = Reflect.get(holder, 'status');
      if (typeof status === 'number') return status;
    }
  }
  return null;
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    for (const key of ['message', 'error']) {
      const value: unknown = Reflect.get(error, key);
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.message;
    }
  }
  return '';
}

/** True when both lists name the same files in the same order. */
export function sameInstances(
  a: ReadonlyArray<{ distributionId: string }>,
  b: ReadonlyArray<{ distributionId: string }>,
): boolean {
  return (
    a.length === b.length &&
    a.every((instance, i) => instance.distributionId === b.at(i)?.distributionId)
  );
}

/**
 * The stack after its storage addresses were renewed. An image that is
 * already loaded is cached under the address it was loaded from, so it
 * keeps that one; every other image takes its fresh address.
 */
export function mergeRefreshedAddresses(
  current: readonly string[],
  /** Positions in the stack whose image is loaded. */
  loaded: ReadonlySet<number>,
  fresh: readonly string[],
): string[] {
  return current.map((id, i) => (loaded.has(i) ? id : (fresh.at(i) ?? id)));
}

/** A transfer syntax UID, with its usual name when it has one. */
export function describeTransferSyntax(uid: string | null): string {
  if (!uid) return 'not stated in the file';
  const name = TRANSFER_SYNTAX_NAMES.get(uid);
  return name ? `${name} (${uid})` : uid;
}

/**
 * Encodings the image loader decodes without failing, but wrongly. It
 * sends JPEG extended (and the retired processes 6 and 8) to one 12-bit
 * JPEG decoder, whatever the bit depth, and that decoder drew a CT
 * series about 4 HU too bright, up to 27 HU in places, where dcmtk
 * decoded the same files right (#778). A wrong picture that looks
 * right is worse than none, so these are refused like a syntax the
 * viewer has no decoder for.
 */
const DRAWN_WRONG: ReadonlySet<string> = new Set([
  '1.2.840.10008.1.2.4.51',
  '1.2.840.10008.1.2.4.53',
  '1.2.840.10008.1.2.4.55',
]);

/** The first position whose encoding the viewer refuses, or null. */
export function firstRefusedEncoding(
  instances: ReadonlyArray<{ transferSyntaxUid: string | null }>,
): number | null {
  const position = instances.findIndex(
    (instance) =>
      instance.transferSyntaxUid !== null && DRAWN_WRONG.has(instance.transferSyntaxUid),
  );
  return position === -1 ? null : position;
}

const TRANSFER_SYNTAX_NAMES: ReadonlyMap<string, string> = new Map([
  ['1.2.840.10008.1.2', 'uncompressed, implicit VR'],
  ['1.2.840.10008.1.2.1', 'uncompressed'],
  ['1.2.840.10008.1.2.2', 'uncompressed, big endian'],
  ['1.2.840.10008.1.2.5', 'RLE'],
  ['1.2.840.10008.1.2.4.50', 'JPEG baseline'],
  ['1.2.840.10008.1.2.4.51', 'JPEG extended'],
  ['1.2.840.10008.1.2.4.53', 'JPEG extended, retired'],
  ['1.2.840.10008.1.2.4.55', 'JPEG full progression, retired'],
  ['1.2.840.10008.1.2.4.57', 'JPEG lossless'],
  ['1.2.840.10008.1.2.4.70', 'JPEG lossless'],
  ['1.2.840.10008.1.2.4.80', 'JPEG-LS lossless'],
  ['1.2.840.10008.1.2.4.81', 'JPEG-LS'],
  ['1.2.840.10008.1.2.4.90', 'JPEG 2000 lossless'],
  ['1.2.840.10008.1.2.4.91', 'JPEG 2000'],
  ['1.2.840.10008.1.2.4.100', 'MPEG-2 video'],
  ['1.2.840.10008.1.2.4.102', 'MPEG-4 video'],
  ['1.2.840.10008.1.2.4.201', 'HTJ2K lossless'],
  ['1.2.840.10008.1.2.4.203', 'HTJ2K'],
]);

/**
 * What the reader has on screen, to store with an answer: the image
 * drawn and how it is displayed. Null whenever the picture is not the
 * image asked for (it is still loading, or could not be loaded): the
 * reader then sees a stand-in, and no image may be recorded as seen.
 */
export function currentView(state: {
  /** The distribution of each image, in stack order. */
  distributionIds: readonly string[];
  /** The image asked for. */
  index: number;
  /** The image the canvas shows. */
  drawnIndex: number;
  failed: ReadonlySet<number>;
  window: WindowSetting | null;
  inverted: boolean;
}): DicomView | null {
  const { distributionIds, index, drawnIndex, failed } = state;
  if (index !== drawnIndex || failed.has(index)) return null;
  const distributionId = distributionIds.at(index);
  if (distributionId === undefined || index < 0) return null;
  return {
    distributionId,
    position: index + 1,
    imageCount: distributionIds.length,
    window: state.window ? { width: state.window.width, center: state.window.center } : null,
    inverted: state.inverted,
  };
}

/** True when two views describe the same screen. */
export function sameView(a: DicomView | null, b: DicomView | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.distributionId === b.distributionId &&
    a.position === b.position &&
    a.imageCount === b.imageCount &&
    a.inverted === b.inverted &&
    a.window?.width === b.window?.width &&
    a.window?.center === b.window?.center
  );
}
