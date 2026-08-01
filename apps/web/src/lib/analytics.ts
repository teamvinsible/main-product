import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let initialized = false;

/** No-ops when VITE_POSTHOG_KEY is unset (e.g. local dev), so analytics calls are safe everywhere without per-call guards. */
export function initAnalytics() {
  if (initialized || typeof window === "undefined" || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false, // client-side route changes don't fire full page loads; see PostHogPageView
    capture_pageleave: true,
    person_profiles: "identified_only",
    session_recording: {
      // Briefs and workspace content are business-sensitive; replay the UI, not what users typed or see.
      // maskAllInputs covers every form field regardless of DOM position (portals included).
      // maskTextSelector additionally blanks rendered text in the authenticated shell and in
      // antd Modal / our OverlayDrawer, both of which portal to document.body and would
      // otherwise escape the [data-ph-mask] wrapper on .app-shell.
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask], .ant-modal-root, .overlay-drawer-root",
    },
  });
  initialized = true;
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function identifyUser(userId: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.identify(userId, properties);
}

export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}

export { posthog };
