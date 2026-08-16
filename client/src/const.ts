import { encodeOAuthState, OAUTH_RETURN_TO_COOKIE, OAUTH_STATE_COOKIE, SIGNUP_USERNAME_COOKIE } from '@shared/const';

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the Manus OAuth flow from an explicit user action.
export const startLogin = (options: { type?: 'signIn' | 'signUp'; returnTo?: string; username?: string } = {}) => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const type = options.type ?? 'signIn';
  const returnTo = options.returnTo && options.returnTo.startsWith('/') && !options.returnTo.startsWith('//') ? options.returnTo : '/';

  const nonce = crypto.randomUUID();
  const cookieOptions = 'Path=/; Max-Age=600; SameSite=None; Secure';
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; ${cookieOptions}`;
  document.cookie = `${OAUTH_RETURN_TO_COOKIE}=${encodeURIComponent(returnTo)}; ${cookieOptions}`;
  if (type === 'signUp' && options.username) {
    document.cookie = `${SIGNUP_USERNAME_COOKIE}=${encodeURIComponent(options.username)}; ${cookieOptions}`;
  } else {
    document.cookie = `${SIGNUP_USERNAME_COOKIE}=; Path=/; Max-Age=0; SameSite=None; Secure`;
  }
  const state = encodeOAuthState({ redirectUri, nonce });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", type);

  window.location.href = url.toString();
};
