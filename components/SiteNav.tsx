"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { signIn, signOut } from "next-auth/react";

/** Mirrors GET /api/account/status. Duplicated from app/page.tsx's own copy rather than shared
 *  — this nav (and the Account modal it owns) is meant to be a fully self-contained widget any
 *  page can drop in without pulling in the giant home-page client component. */
interface AccountStatus {
  email: string | null;
  name: string | null;
  autoPushToGithub: boolean;
  connection: { githubLogin: string; scope: string; usable: boolean } | null;
  connectionNeedsReauth: boolean;
  lastPush: { repoUrl: string | null; error: string | null; createdAt: string } | null;
}

interface SiteNavProps {
  /** The home page shows a richer promotional sign-in modal (guest-conversion messaging) instead
   *  of going straight to GitHub — passed in so this shared nav can trigger that instead of its
   *  own default (a direct signIn() redirecting back to the current page). */
  onSignInClick?: () => void;
}

/**
 * Fixed top nav pill, rendered on every page that wants it (not the WebContainer preview pages,
 * which are deliberately full-screen). Fetches its own sign-in state and owns the Account modal
 * outright so History/Account (and anywhere else) can show the same nav the home page always
 * had, without page.tsx's local state.
 */
export default function SiteNav({ onSignInClick }: SiteNavProps) {
  const pathname = usePathname();
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountActionBusy, setAccountActionBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (!cancelled) setIsSignedIn(Boolean(data?.user));
      } catch {
        // best effort — worst case the nav shows signed-out until a real navigation re-checks
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showAccountModal) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAccountModal(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAccountModal]);

  async function openAccountModal() {
    setShowAccountModal(true);
    setAccountLoading(true);
    try {
      const res = await fetch("/api/account/status");
      const data = await res.json();
      if (res.ok) setAccountStatus(data);
    } finally {
      setAccountLoading(false);
    }
  }

  async function toggleAutoPush(enabled: boolean) {
    setAccountActionBusy(true);
    try {
      const res = await fetch("/api/account/github/autopush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) setAccountStatus((prev) => (prev ? { ...prev, autoPushToGithub: enabled } : prev));
    } finally {
      setAccountActionBusy(false);
    }
  }

  async function disconnectGithubAccount() {
    setAccountActionBusy(true);
    try {
      const res = await fetch("/api/account/github/disconnect", { method: "POST" });
      if (res.ok) {
        setAccountStatus((prev) =>
          prev ? { ...prev, connection: null, connectionNeedsReauth: false, autoPushToGithub: false } : prev
        );
      }
    } finally {
      setAccountActionBusy(false);
    }
  }

  function connectGithubForRepoAccess() {
    signIn("github", { redirectTo: pathname }, { scope: "read:user user:email repo" });
  }

  const inactivePillClass =
    "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-white";
  const activePillClass = "bg-neutral-100 dark:bg-white/10 text-neutral-900 dark:text-white";

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed top-0 left-0 right-0 z-50 flex justify-center pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pointer-events-none"
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-neutral-200 dark:border-white/10 bg-white/80 dark:bg-neutral-900/70 backdrop-blur-xl shadow-lg p-1.5">
          <Link href="/" className="rounded-full px-4 py-2 hover:bg-neutral-100 dark:hover:bg-white/10">
            {/* Logo.png is a black mark on a transparent background — dark:invert flips it to
                white for this app's forced-dark theme (see globals.css) while still degrading
                correctly if that forcing were ever relaxed back to following the OS preference. */}
            <Image src="/Logo.png" alt="What To Do?" width={96} height={54} className="h-5 w-auto dark:invert" priority />
          </Link>
          <div className="hidden sm:block h-4 w-px bg-neutral-200 dark:bg-white/10 mx-1" />
          <div className="hidden sm:flex items-center gap-1">
            <Link
              href="/#about"
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${inactivePillClass}`}
            >
              About
            </Link>
            <Link
              href="/#faq"
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${inactivePillClass}`}
            >
              FAQ
            </Link>
          </div>
          <div className="h-4 w-px bg-neutral-200 dark:bg-white/10 mx-1" />
          {isSignedIn ? (
            <>
              <Link
                href="/history"
                aria-current={pathname === "/history" ? "page" : undefined}
                className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                  pathname === "/history" ? activePillClass : inactivePillClass
                }`}
              >
                History
              </Link>
              <button
                type="button"
                onClick={openAccountModal}
                aria-current={showAccountModal ? "true" : undefined}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  showAccountModal
                    ? "bg-neutral-700 dark:bg-neutral-200 text-white dark:text-neutral-900"
                    : "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-200"
                }`}
              >
                Account
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onSignInClick ?? (() => signIn("github", { redirectTo: pathname }))}
              className="rounded-full bg-neutral-900 dark:bg-white px-4 py-2 text-sm font-bold text-white dark:text-neutral-900 transition-colors hover:bg-neutral-700 dark:hover:bg-neutral-200"
            >
              Sign in
            </button>
          )}
        </div>
      </nav>

      {showAccountModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAccountModal(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-modal-title"
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="account-modal-title" className="text-lg font-semibold">
                Account
              </h2>
              <button
                type="button"
                onClick={() => setShowAccountModal(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            {accountLoading && !accountStatus ? (
              <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
            ) : accountStatus ? (
              <div className="mt-4 space-y-6">
                <div>
                  <p className="text-sm">
                    Signed in as <strong>{accountStatus.email ?? accountStatus.name}</strong>
                  </p>
                  <button
                    type="button"
                    onClick={() => signOut({ redirectTo: "/" })}
                    className="mt-3 rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium"
                  >
                    Sign out
                  </button>
                </div>

                <div className="border-t border-neutral-200 dark:border-neutral-800 pt-6">
                  <h3 className="text-sm font-semibold">GitHub repo push</h3>
                  <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                    When enabled, a new GitHub repo is created automatically from your boilerplate the next time
                    you sign up from a guest session.
                  </p>

                  {accountStatus.connection ? (
                    <div className="mt-4 space-y-3">
                      {!accountStatus.connectionNeedsReauth ? (
                        <p className="text-sm">
                          Connected as <strong>{accountStatus.connection.githubLogin}</strong> (repo access
                          granted).
                        </p>
                      ) : (
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                          Your GitHub connection needs to be re-established (
                          {!accountStatus.connection.usable
                            ? "couldn't verify it's still valid"
                            : "GitHub rejected the stored access, likely revoked on GitHub's side"}
                          ) — disconnect below, then reconnect.
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => toggleAutoPush(!accountStatus.autoPushToGithub)}
                          disabled={accountActionBusy || (accountStatus.connectionNeedsReauth && !accountStatus.autoPushToGithub)}
                          className="rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          {accountStatus.autoPushToGithub ? "Turn off auto-push" : "Turn on auto-push"}
                        </button>
                        <button
                          type="button"
                          onClick={disconnectGithubAccount}
                          disabled={accountActionBusy}
                          className="rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          Disconnect GitHub
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={connectGithubForRepoAccess}
                      className="mt-4 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
                    >
                      Connect GitHub for repo access
                    </button>
                  )}

                  {accountStatus.lastPush && (
                    <div className="mt-4 rounded-md border border-neutral-200 dark:border-neutral-800 p-3 text-sm">
                      <p className="font-medium">Last push</p>
                      {accountStatus.lastPush.repoUrl ? (
                        <p className="mt-1">
                          <a
                            href={accountStatus.lastPush.repoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            {accountStatus.lastPush.repoUrl}
                          </a>
                        </p>
                      ) : (
                        <>
                          <p className="mt-1 text-red-600 dark:text-red-400">Failed: {accountStatus.lastPush.error}</p>
                          {/* connectionNeedsReauth is already timestamp-guarded server-side (see
                              lib/github/connection.ts) — if this error text looks like a bad-
                              credentials failure but the connection ISN'T flagged as needing
                              reauth, the only way that combination happens is a stale record from
                              before the most recent reconnect. */}
                          {!accountStatus.connectionNeedsReauth && accountStatus.lastPush.error?.includes("failed (401)") && (
                            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                              Recorded before your most recent reconnect, so this doesn&apos;t reflect your current
                              connection — it&apos;ll update the next time an auto-push runs.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400">Couldn&apos;t load account details.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
