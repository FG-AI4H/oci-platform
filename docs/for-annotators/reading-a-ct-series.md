# Reading a CT series

_[Version française](./reading-a-ct-series.fr.md)_

Some campaigns ask you to read a whole exam, such as a brain CT, rather than a single image. The exam opens in the platform's own viewer, on the same page as the answer form. You give one answer per exam.

## Before you start

- Use **Chrome, Edge or Safari**, on a computer or a tablet. Firefox has not been tested.
- A CT series is a few dozen to a few hundred images. They load while you read, the images next to the one on screen first. A steady connection is enough; you don't need to wait for all of them.
- Don't take screenshots and don't save images. The files stay on the platform.

## Open an exam

1. On the campaign's annotate page, press **Start**. The platform gives you the next exam waiting for you.
2. The first image is drawn as soon as it arrives. The counter under the image shows where you are, for instance `1 / 32`, and the line below it says how many images have loaded.

Nothing on the page names the patient, the file or the dataset. That is on purpose ([ADR-0010](../adr/0010-annotation-metadata-exposure-and-blinding.md)).

## Move through the images

| To                         | Mouse or touch            | Keyboard (click the image first)  |
| -------------------------- | ------------------------- | --------------------------------- |
| Go to the next or previous | Mouse wheel, one notch    | Arrow Down or Up (or Right, Left) |
| Jump                       | Drag the **Image** slider | Page Down or Up (ten at a time)   |
| Go to the first or last    | Slider to either end      | Home or End                       |

On a tablet, use the slider.

## Set the window

The window decides which densities are shown as grey. The current one is shown as `W 80 · L 40` (width and level, in Hounsfield units).

- **Presets**, one click each: **Brain** (80 / 40), **Subdural** (200 / 75), **Bone** (2000 / 500), **Lung** (1500 / −600), **Mediastinum** (350 / 50). The preset in use is marked.
- **Drag** on the image with the left button: sideways changes the width, up and down the level.
- **Type** a width and a level in the **Window** fields.

The window you start with is the one the file proposes. If the file proposes none, the viewer picks one from the image’s range of values.

## Zoom, move, invert

- Zoom: drag with the right button, or **+** and **−**.
- Move the image: Shift and drag, or Shift and the arrow keys.
- **Invert** (or **I**) swaps black and white. **Reset** (or **R**) brings back the starting zoom, position and window, not inverted.

Open **Mouse and keyboard** under the viewer for the same list.

## Answer

1. Pick your answer: click it, or press its number. If the campaign allows a comment, you can add one.
2. **Before you submit, leave on screen the image that supports your answer**, in the window you used. The platform records with your answer which image was on screen, as its place in the series (for instance image 14 of 32), and the window. This is part of the record of your reading, and it helps if a disagreement has to be settled.
3. Press **Submit** (or Enter).

If you submit before the first image is drawn, the page says _The image is not on screen yet_. Your answer is kept; wait for the image and submit again.

After you submit, **Start the next task** is ready.

## Can't read it?

Press **Skip**. The exam goes back to the queue for someone else, and you get a different one first. If the exam itself seems wrong (images missing, the wrong body part, anything that should not be there), skip it and tell the campaign manager.

## If you settle disagreements

If you are an arbiter, you only get exams you did not read. You see the exam in the same viewer and the readers' answers, without their names. Choose the final answer, say why in **Reason**, and submit with the image that supports it on screen.

## When something goes wrong

| The viewer says                                      | What to do                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| _N of M images could not be loaded_                  | Read on; each missing image says so when you reach it. If one you need is missing, reload the page.              |
| _The series could not be opened_                     | Check your connection and reload the page. If it happens again, skip the exam.                                   |
| _The viewer cannot show this series faithfully_      | Skip the exam and tell the campaign manager. Its images are stored in a way the viewer cannot display correctly. |
| _The viewer cannot decode this series_               | Skip the exam and tell the campaign manager.                                                                     |
| _The series changed_ or _The viewer could not start_ | Reload the page. If it happens again, skip the exam and tell the campaign manager.                               |
