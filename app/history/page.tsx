"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import type { PlatformHint, PrdSection, StackCategory, StackRecommendation } from "@/lib/types";

/** Mirrors GET /api/account/history's `projects` array entries. */
interface HistoryProject {
  projectId: string;
  prompt: string;
  createdAt: string;
  sections: PrdSection[];
  lowConfidence: boolean;
  stack: StackRecommendation | null;
  hasBoilerplate: boolean;
  platform: PlatformHint | null;
}

type LoadState = "loading" | "signed-out" | "error" | { projects: HistoryProject[] };

/** Stable reference (not a fresh `[]` literal each render) so it doesn't spuriously change the
 *  identity of the `projects` variable derived from it below, which would otherwise needlessly
 *  re-run the useMemo filter that depends on it. */
const EMPTY_PROJECTS: HistoryProject[] = [];

const STACK_CATEGORIES: { key: StackCategory; label: string }[] = [
  { key: "frontend", label: "Frontend" },
  { key: "backend", label: "Backend" },
  { key: "database", label: "Database" },
  { key: "hosting", label: "Hosting" },
  { key: "auth", label: "Auth" },
];

/** One small badge icon per PRD section key — duplicated from app/page.tsx rather than shared,
 *  deliberately: that file is large and already thoroughly tested, and these are small, pure,
 *  self-contained functions with no other dependencies, so the risk of editing it to extract them
 *  outweighs the cost of ~80 duplicated lines. */
function getSectionIcon(key: string) {
  const common = { viewBox: "0 0 24 24", className: "h-3.5 w-3.5", "aria-hidden": true } as const;
  switch (key) {
    case "problem_statement":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="7" x2="12" y2="13" />
          <circle cx="12" cy="16.5" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      );
    case "target_user":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </svg>
      );
    case "core_features":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 12 9 17 20 6" />
        </svg>
      );
    case "user_stories":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20l3-4h2l3 4" />
        </svg>
      );
    case "out_of_scope":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case "complexity_estimate":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15.5 14" />
        </svg>
      );
    default:
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      );
  }
}

function getStackCategoryIcon(key: StackCategory) {
  const common = { viewBox: "0 0 24 24", className: "h-3.5 w-3.5", "aria-hidden": true } as const;
  switch (key) {
    case "frontend":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <line x1="3" y1="8" x2="21" y2="8" />
        </svg>
      );
    case "backend":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
          <line x1="7" y1="17" x2="7.01" y2="17" />
        </svg>
      );
    case "database":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
          <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      );
    case "hosting":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 18a4.5 4.5 0 0 1-1-8.9A5.5 5.5 0 0 1 16.5 9a4 4 0 0 1 .5 8H7Z" />
        </svg>
      );
    case "auth":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
  }
}

export default function HistoryPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | PlatformHint>("all");
  const [selected, setSelected] = useState<HistoryProject | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/history");
        if (res.status === 401) {
          if (!cancelled) setState("signed-out");
          return;
        }
        const data = await res.json();
        if (!cancelled) setState(res.ok ? { projects: data.projects } : "error");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const projects = typeof state === "object" ? state.projects : EMPTY_PROJECTS;

  // Search matches topic/name (the prompt — there's no separate "name" field, the idea's
  // description doubles as its name) and tech stack choices together in one box, rather than
  // making the user pick a search scope first for fields that are this closely related.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      const matchesPlatform = platformFilter === "all" || p.platform === platformFilter;
      if (!matchesPlatform) return false;
      if (!q) return true;
      const matchesPrompt = p.prompt.toLowerCase().includes(q);
      const matchesStack = p.stack ? Object.values(p.stack).some((piece) => piece.choice.toLowerCase().includes(q)) : false;
      return matchesPrompt || matchesStack;
    });
  }, [projects, query, platformFilter]);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-12 pb-16">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:underline">
            ← Back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">History</h1>
        </div>
      </div>

      {state === "loading" && <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>}

      {state === "error" && (
        <p className="mt-8 text-sm text-red-600 dark:text-red-400">Couldn&apos;t load your history right now.</p>
      )}

      {state === "signed-out" && (
        <div className="mt-8">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Sign in to see your saved projects.</p>
          <button
            type="button"
            onClick={() => signIn("github", { redirectTo: "/history" })}
            className="mt-4 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
          >
            Sign in with GitHub
          </button>
        </div>
      )}

      {typeof state === "object" && (
        <>
          {selected ? (
            <div className="mt-8 space-y-6">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:underline"
              >
                ← Back to list
              </button>

              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
                  Idea
                </p>
                <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{selected.prompt}</p>
              </div>

              {selected.sections.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
                    Product Requirements
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {selected.sections.map((section) => (
                      <div
                        key={section.key}
                        className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-white/[0.03] p-4"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900">
                            {getSectionIcon(section.key)}
                          </span>
                          <h2 className="text-sm font-semibold">{section.title}</h2>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
                          {section.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.stack && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
                    Tech Stack
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {STACK_CATEGORIES.map(({ key, label }) => (
                      <div
                        key={key}
                        className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-white/[0.03] p-4"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900">
                            {getStackCategoryIcon(key)}
                          </span>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                            {label}
                          </h3>
                        </div>
                        <p className="mt-2 text-sm font-medium">{selected.stack![key].choice}</p>
                        <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">
                          {selected.stack![key].rationale}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.hasBoilerplate && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  A generated boilerplate was saved with this project too.
                </p>
              )}

              <p className="text-xs text-neutral-500">
                This is a read-only summary — full editing of a saved project is coming soon.
              </p>
            </div>
          ) : (
            <div className="mt-8">
              <div className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="history-search" className="sr-only">
                  Search by topic, tech stack, or name
                </label>
                <input
                  id="history-search"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by topic, tech stack, or name"
                  className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100"
                />
                <label htmlFor="history-platform" className="sr-only">
                  Filter by platform
                </label>
                <select
                  id="history-platform"
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value as "all" | PlatformHint)}
                  className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm sm:w-40"
                >
                  <option value="all">All platforms</option>
                  <option value="web">Web</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>

              {projects.length === 0 ? (
                <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
                  No saved projects yet — sign up from a guest session to keep one here.
                </p>
              ) : filtered.length === 0 ? (
                <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">No projects match that search.</p>
              ) : (
                <ul className="mt-6 divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800">
                  {filtered.map((project) => (
                    <li key={project.projectId}>
                      <button
                        type="button"
                        onClick={() => setSelected(project)}
                        className="block w-full px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-white/5"
                      >
                        <p className="truncate text-sm font-medium">{project.prompt}</p>
                        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                          {new Date(project.createdAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                          {project.platform && ` · ${project.platform === "web" ? "Web" : "Mobile"}`}
                          {project.stack && ` · ${project.stack.frontend.choice}`}
                          {project.hasBoilerplate && " · Boilerplate"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
