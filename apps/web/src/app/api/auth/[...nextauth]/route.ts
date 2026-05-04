import { handlers } from '../../../../auth';

// NextAuth v5 mounts on /api/auth/* — sign-in initiates the OAuth code
// flow against Cognito; the callback at /api/auth/callback/cognito
// completes it; sign-out clears the local session.
export const { GET, POST } = handlers;
