import { describe, expect, it } from 'vitest';
import { DicomViewSchema } from '@oci/shared-types';
import {
  CT_PRESETS,
  PAN_STEP,
  actionForKey,
  clampIndex,
  classifyLoadFailure,
  currentView,
  describeTransferSyntax,
  dragWindow,
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
} from './viewer-logic';

describe('window arithmetic', () => {
  it('turns a width and level into the range the renderer takes, by the DICOM definition, and back', () => {
    // Width 80 centred on 40 spans the 80 values 0..79.
    expect(toVoiRange({ width: 80, center: 40 })).toEqual({ lower: 0, upper: 79 });
    expect(toVoiRange({ width: 1500, center: -600 })).toEqual({ lower: -1350, upper: 149 });
    // What the renderer reports for a file that declares 1500 / -650.
    expect(fromVoiRange({ lower: -1400, upper: 99 })).toEqual({ width: 1500, center: -650 });
    for (const preset of CT_PRESETS) {
      expect(fromVoiRange(toVoiRange(preset))).toEqual({
        width: preset.width,
        center: preset.center,
      });
    }
  });

  it('offers the five CT windows a reader of a head or chest exam expects', () => {
    expect(CT_PRESETS.map((p) => [p.id, p.width, p.center])).toEqual([
      ['brain', 80, 40],
      ['subdural', 200, 75],
      ['bone', 2000, 500],
      ['lung', 1500, -600],
      ['mediastinum', 350, 50],
    ]);
  });

  it('recognises a preset only when the window is exactly it', () => {
    expect(matchingPreset({ width: 80, center: 40 })?.id).toBe('brain');
    expect(matchingPreset({ width: 81, center: 40 })).toBeNull();
    expect(matchingPreset(null)).toBeNull();
  });

  it('drags finely on a narrow window and coarsely on a wide one', () => {
    // Brain: half a unit per pixel.
    expect(dragWindow({ width: 80, center: 40 }, 10, 0)).toEqual({ width: 85, center: 40 });
    expect(dragWindow({ width: 80, center: 40 }, 0, 10)).toEqual({ width: 80, center: 45 });
    // Bone: ten units per pixel.
    expect(dragWindow({ width: 2000, center: 500 }, 10, -10)).toEqual({
      width: 2100,
      center: 400,
    });
  });

  it('narrows and widens by the same amount when dragged slowly, one pixel at a time', () => {
    // The drag works on the exact window. Rounding between events
    // would undo every half-unit step to the left and double every one
    // to the right.
    let narrowing = exactFromVoiRange(toVoiRange({ width: 80, center: 40 }));
    let widening = narrowing;
    for (let i = 0; i < 10; i += 1) {
      narrowing = exactFromVoiRange(toVoiRange(dragWindow(narrowing, -1, -1)));
      widening = exactFromVoiRange(toVoiRange(dragWindow(widening, 1, 1)));
    }
    expect(narrowing.width).toBeLessThan(80);
    expect(narrowing.center).toBeLessThan(40);
    expect(80 - narrowing.width).toBeCloseTo(widening.width - 80, 0);
    expect(40 - narrowing.center).toBeCloseTo(widening.center - 40, 0);
  });

  it('never lets a drag close the window', () => {
    expect(dragWindow({ width: 4, center: 0 }, -1000, 0).width).toBe(1);
  });
});

describe('clampIndex', () => {
  it('keeps an index inside the stack', () => {
    expect(clampIndex(-3, 49)).toBe(0);
    expect(clampIndex(12, 49)).toBe(12);
    expect(clampIndex(60, 49)).toBe(48);
    expect(clampIndex(5, 0)).toBe(0);
  });
});

describe('actionForKey', () => {
  it('moves through the stack with the arrows, by ten with the page keys, to the ends with Home and End', () => {
    expect(actionForKey('ArrowDown', false)).toEqual({ type: 'step', delta: 1 });
    expect(actionForKey('ArrowRight', false)).toEqual({ type: 'step', delta: 1 });
    expect(actionForKey('ArrowUp', false)).toEqual({ type: 'step', delta: -1 });
    expect(actionForKey('ArrowLeft', false)).toEqual({ type: 'step', delta: -1 });
    expect(actionForKey('PageDown', false)).toEqual({ type: 'step', delta: 10 });
    expect(actionForKey('PageUp', false)).toEqual({ type: 'step', delta: -10 });
    expect(actionForKey('Home', false)).toEqual({ type: 'first' });
    expect(actionForKey('End', false)).toEqual({ type: 'last' });
  });

  it('moves the picture with Shift and an arrow, and each move has its opposite', () => {
    expect(actionForKey('ArrowLeft', true)).toEqual({ type: 'pan', dx: -PAN_STEP, dy: 0 });
    expect(actionForKey('ArrowRight', true)).toEqual({ type: 'pan', dx: PAN_STEP, dy: 0 });
    expect(actionForKey('ArrowUp', true)).toEqual({ type: 'pan', dx: 0, dy: -PAN_STEP });
    expect(actionForKey('ArrowDown', true)).toEqual({ type: 'pan', dx: 0, dy: PAN_STEP });
  });

  it('zooms, inverts and resets, whatever the keyboard layout does with Shift', () => {
    const zoomIn = actionForKey('+', true);
    const zoomOut = actionForKey('-', false);
    expect(zoomIn).toMatchObject({ type: 'zoom' });
    expect(actionForKey('=', false)).toEqual(zoomIn);
    expect(zoomIn?.type === 'zoom' && zoomOut?.type === 'zoom').toBe(true);
    if (zoomIn?.type === 'zoom' && zoomOut?.type === 'zoom') {
      expect(zoomIn.factor * zoomOut.factor).toBeCloseTo(1);
    }
    expect(actionForKey('i', false)).toEqual({ type: 'invert' });
    expect(actionForKey('I', true)).toEqual({ type: 'invert' });
    expect(actionForKey('r', false)).toEqual({ type: 'reset' });
  });

  it('leaves every other key to the browser', () => {
    for (const key of ['Tab', 'Escape', 'Enter', ' ', 'a', 'F5']) {
      expect(actionForKey(key, false), key).toBeNull();
    }
  });
});

describe('wheelSteps', () => {
  it('moves exactly one image per notch of a mouse wheel, however the browser reports it', () => {
    // Chromium: 100 pixels a notch. Never two images for one notch.
    expect(wheelSteps(0, 100, 0)).toEqual({ steps: 1, carried: 0 });
    expect(wheelSteps(0, -100, 0)).toEqual({ steps: -1, carried: 0 });
    expect(wheelSteps(0, 120, 0)).toEqual({ steps: 1, carried: 0 });
    // Lines and pages.
    expect(wheelSteps(0, 3, 1)).toEqual({ steps: 1, carried: 0 });
    expect(wheelSteps(0, -1, 2)).toEqual({ steps: -1, carried: 0 });
  });

  it('reaches every image of a stack with one notch at a time', () => {
    let position = 0;
    const seen = [position];
    for (let notch = 0; notch < 5; notch += 1) {
      position += wheelSteps(0, 100, 0).steps;
      seen.push(position);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('adds up the small movements of a trackpad instead of jumping an image each', () => {
    let carried = 0;
    let moved = 0;
    for (let i = 0; i < 20; i += 1) {
      const out = wheelSteps(carried, 4, 0);
      carried = out.carried;
      moved += out.steps;
    }
    expect(moved).toBe(2);
    expect(carried).toBe(0);
  });

  it('forgets a half-finished movement when the direction changes', () => {
    const down = wheelSteps(0, 30, 0);
    expect(down).toEqual({ steps: 0, carried: 30 });
    // Without the reset, 30 down then 12 up would still be +18.
    expect(wheelSteps(down.carried, -12, 0)).toEqual({ steps: 0, carried: -12 });
    expect(wheelSteps(0, 0, 0)).toEqual({ steps: 0, carried: 0 });
  });
});

describe('usableLifetimeMs', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z');

  it('is the time left when the reader and the server agree on the time', () => {
    expect(usableLifetimeMs('2026-11-20T12:15:00.000Z', now)).toBe(15 * 60_000);
    expect(usableLifetimeMs('2026-11-20T12:06:00.000Z', now)).toBe(6 * 60_000);
  });

  it('is not believed when the clocks disagree, in either direction', () => {
    // Reader 20 minutes ahead: "expired five minutes ago".
    expect(usableLifetimeMs('2026-11-20T11:55:00.000Z', now)).toBeNull();
    // Reader an hour behind.
    expect(usableLifetimeMs('2026-11-20T13:15:00.000Z', now)).toBeNull();
    expect(usableLifetimeMs('2026-11-20T12:00:30.000Z', now)).toBeNull();
    expect(usableLifetimeMs('not a date', now)).toBeNull();
  });
});

describe('classifyLoadFailure', () => {
  it('reads a refused storage address from the request the loader rejects with', () => {
    expect(classifyLoadFailure({ status: 403, readyState: 4 })).toBe('address');
    expect(classifyLoadFailure({ request: { status: 403 } })).toBe('address');
    expect(classifyLoadFailure({ xhr: { status: 401 } })).toBe('address');
  });

  it('tells a missing decoder from everything else, since asking again cannot fix it', () => {
    expect(
      classifyLoadFailure(new Error('no decoder for transfer syntax 1.2.840.10008.1.2.4.100')),
    ).toBe('decoder');
    expect(classifyLoadFailure({ error: new Error('No decoder for transfer syntax 1.2.3') })).toBe(
      'decoder',
    );
    expect(classifyLoadFailure('no decoder for transfer syntax 1.2.3')).toBe('decoder');
  });

  it('calls a request that never completed a network failure', () => {
    expect(classifyLoadFailure({ status: 0 })).toBe('network');
    expect(classifyLoadFailure(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('does not guess about anything else', () => {
    expect(classifyLoadFailure({ status: 500 })).toBe('other');
    expect(classifyLoadFailure(new Error('boom'))).toBe('other');
    expect(classifyLoadFailure(undefined)).toBe('other');
    expect(classifyLoadFailure(null)).toBe('other');
  });
});

describe('renewing storage addresses', () => {
  it('keeps the address an image was loaded from and takes the new one for the others', () => {
    expect(
      mergeRefreshedAddresses(['a1', 'b1', 'c1'], new Set([0, 2]), ['a2', 'b2', 'c2']),
    ).toEqual(['a1', 'b2', 'c1']);
  });

  it('keeps what it has when the new list is shorter', () => {
    expect(mergeRefreshedAddresses(['a1', 'b1'], new Set(), ['a2'])).toEqual(['a2', 'b1']);
  });

  it('knows when the series is no longer made of the same files', () => {
    const a = [{ distributionId: '1' }, { distributionId: '2' }];
    expect(sameInstances(a, [{ distributionId: '1' }, { distributionId: '2' }])).toBe(true);
    expect(sameInstances(a, [{ distributionId: '2' }, { distributionId: '1' }])).toBe(false);
    expect(sameInstances(a, [{ distributionId: '1' }])).toBe(false);
  });
});

describe('describeTransferSyntax', () => {
  it('names the usual ones and shows the UID of the others', () => {
    expect(describeTransferSyntax('1.2.840.10008.1.2.4.90')).toBe(
      'JPEG 2000 lossless (1.2.840.10008.1.2.4.90)',
    );
    expect(describeTransferSyntax('1.2.3.4')).toBe('1.2.3.4');
    expect(describeTransferSyntax(null)).toBe('not stated in the file');
  });
});

describe('the view stored with an answer', () => {
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ];
  const state = {
    distributionIds: ids,
    index: 1,
    drawnIndex: 1,
    failed: new Set<number>(),
    window: { width: 80, center: 40 },
    inverted: false,
  };

  it('names the image drawn by its distribution and its place in the stack, from 1', () => {
    const view = currentView(state);
    expect(view).toEqual({
      distributionId: ids[1],
      position: 2,
      imageCount: 3,
      window: { width: 80, center: 40 },
      inverted: false,
    });
    // What the viewer reports is what an answer accepts.
    expect(DicomViewSchema.safeParse(view).success).toBe(true);
    expect(currentView({ ...state, index: 2, drawnIndex: 2, inverted: true })).toMatchObject({
      distributionId: ids[2],
      position: 3,
      inverted: true,
    });
    expect(currentView({ ...state, window: null })?.window).toBeNull();
  });

  it('reports nothing while the picture is not the image asked for', () => {
    // Still loading: the canvas holds the previous image under a stand-in.
    expect(currentView({ ...state, index: 2, drawnIndex: 1 })).toBeNull();
    // Could not be loaded.
    expect(currentView({ ...state, failed: new Set([1]) })).toBeNull();
    // Nothing known about the stack yet.
    expect(currentView({ ...state, distributionIds: [] })).toBeNull();
  });

  it('does not keep a reference to the window it was given', () => {
    const window = { width: 80, center: 40 };
    const view = currentView({ ...state, window });
    window.width = 400;
    expect(view?.window).toEqual({ width: 80, center: 40 });
  });

  it('tells a change of image, window or inversion from the same screen', () => {
    const view = currentView(state);
    expect(sameView(view, currentView(state))).toBe(true);
    expect(sameView(null, null)).toBe(true);
    expect(sameView(view, null)).toBe(false);
    expect(sameView(view, currentView({ ...state, index: 0, drawnIndex: 0 }))).toBe(false);
    expect(sameView(view, currentView({ ...state, window: { width: 81, center: 40 } }))).toBe(
      false,
    );
    expect(sameView(view, currentView({ ...state, window: null }))).toBe(false);
    expect(sameView(view, currentView({ ...state, inverted: true }))).toBe(false);
  });
});

describe('which image to fetch next', () => {
  const order = (current: number, count: number, taken: number[] = []) => {
    const done = new Set(taken);
    const out: number[] = [];
    for (let next = nextToLoad(current, count, done); next !== null; ) {
      out.push(next);
      done.add(next);
      next = nextToLoad(current, count, done);
    }
    return out;
  };

  it('from the first image, the stack in order', () => {
    expect(order(0, 6, [0])).toEqual([1, 2, 3, 4, 5]);
  });

  it('after a jump, the neighbours first, after then before, one step further each time', () => {
    expect(order(5, 9, [0, 1, 2])).toEqual([5, 6, 4, 7, 3, 8]);
    // The image on screen itself first, if it is not there yet.
    expect(nextToLoad(5, 9, new Set([0]))).toBe(5);
  });

  it('near an end, the other side only', () => {
    expect(order(8, 9, [0, 8])).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(order(0, 4, [0])).toEqual([1, 2, 3]);
  });

  it('skips what is loaded or on its way, and stops when nothing is left', () => {
    expect(nextToLoad(3, 6, new Set([3, 4]))).toBe(2);
    expect(nextToLoad(3, 6, new Set([0, 1, 2, 3, 4, 5]))).toBeNull();
    expect(nextToLoad(0, 0, new Set())).toBeNull();
  });

  it('takes a position outside the stack as its nearest end', () => {
    expect(nextToLoad(40, 5, new Set())).toBe(4);
    expect(nextToLoad(-3, 5, new Set())).toBe(0);
  });
});
