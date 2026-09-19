import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";
import { clearBasketStorage, reconcileBasketOwner } from "@/hooks/useRfqBasket";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  // Login is started via startLogin() in the effect below, only when we actually
  // navigate — never during render. startLogin() mints a one-time nonce + writes
  // the state cookie, so calling it per render would overwrite the cookie and
  // desync it from an in-flight login's `state`.
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // Clear the Preview auto-login token mirrored into sessionStorage, so
      // header-based sessions (Safari ITP / WebView) are logged out too. The
      // backend cookie is cleared by the logout mutation.
      try {
        sessionStorage.removeItem("manus-cookie");
      } catch {}
      // Deterministically, here rather than in an effect: a logout that
      // navigates away, or one triggered by an expired session, must still
      // leave no basket behind for the next person at this browser.
      clearBasketStorage();
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  /**
   * The RFQ basket belongs to the account that filled it. On a shared machine
   * a basket left by the previous person must not reappear under the next
   * person's account - the contents are only public catalogue ids, but a
   * request submitted with somebody else's lines is still somebody else's
   * request. Runs on every identity change, including logout (null).
   */
  useEffect(() => {
    if (meQuery.isLoading) return;
    reconcileBasketOwner(meQuery.data?.id ?? null);
  }, [meQuery.data?.id, meQuery.isLoading]);

  /**
   * "NOT SIGNED IN" AND "COULD NOT CHECK" ARE DIFFERENT ANSWERS HERE TOO.
   *
   * The server stopped conflating them - `auth.me` now raises
   * INTERNAL_SERVER_ERROR rather than answering null when the user store is
   * unreachable - and this hook undid that in one line: a thrown query leaves
   * `data` undefined, `isAuthenticated` went false, and every guard in the app
   * drew its sign-in screen. A signed-in administrator was shown "Sign In" in
   * the middle of an investigation, over an outage that had nothing to do with
   * their session.
   *
   * `authUnknown` is the third state. Guards that use it keep the person where
   * they are and say the section could not load; nothing here grants access -
   * `isAuthenticated` is still false, and every protected procedure is still
   * refused by the server, which is where access is decided.
   */
  const authUnknown = Boolean(
    meQuery.error && meQuery.error.data?.code !== "UNAUTHORIZED",
  );

  const state = useMemo(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
      /** The session could not be checked. NOT a statement about the session. */
      authUnknown,
      retryAuth: () => void meQuery.refetch(),
    };
  }, [
    authUnknown,
    meQuery,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    // An unanswerable question is not a reason to send somebody to a sign-in
    // screen - especially not one they cannot use, because whatever stopped
    // the session check will stop the sign-in too.
    if (authUnknown) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    // Use the shared auth page when no explicit destination is supplied so
    // locally managed dummy/test accounts can sign in without OAuth verification.
    if (redirectPath) {
      window.location.href = redirectPath;
    } else if (window.location.pathname !== "/auth") {
      window.location.href = "/auth?mode=login";
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
