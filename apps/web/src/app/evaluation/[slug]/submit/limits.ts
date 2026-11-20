/**
 * Largest predictions file the submit form takes (#645).
 *
 * A server action's request body is capped at 1 MB by Next.js, and a request
 * over that fails before the action runs, with nothing the page can show. So
 * the form refuses a larger file itself, in the browser and again in the
 * action, with a sentence. 512 KiB is about 25,000 lines of `identifier,label`;
 * the tasks hosted today have a few hundred items.
 *
 * In a module of its own because a `'use server'` file may export only async
 * functions, and both the action and the client form need the number.
 */
export const MAX_PREDICTIONS_FILE_BYTES = 512 * 1024;

export const MAX_PREDICTIONS_FILE_LABEL = '512 KB';
