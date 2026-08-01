/** Central event-name vocabulary — capture calls should reference these, not string literals, so names never drift across call sites. */
export const AnalyticsEvent = {
  CTA_CLICKED: "cta_clicked",
  SIGNED_IN: "signed_in",
  SIGNED_OUT: "signed_out",
} as const;
