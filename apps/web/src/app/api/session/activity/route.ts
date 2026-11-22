import { auth } from '../../../../auth';

/**
 * Where an open page reports that someone is using it (#643).
 *
 * A reader can study one image, or fill in one form, for a long time
 * without the browser sending anything, and would otherwise look idle.
 * `SessionActivity` posts here when the user moves, types or scrolls,
 * a few minutes apart at most. Like any other request it passes through
 * `proxy.ts`, where the session callback records the activity and
 * renews the access token if it is due; this handler has nothing to add
 * but the answer.
 *
 * 204 while the session lives, 401 once it has ended.
 */
export async function POST(): Promise<Response> {
  const session = await auth();
  return new Response(null, {
    status: session?.user ? 204 : 401,
    headers: { 'Cache-Control': 'no-store' },
  });
}
