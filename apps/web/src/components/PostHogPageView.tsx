import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { capture } from "../lib/analytics";

/** react-router client-side navigation doesn't fire full page loads, so pageviews are captured explicitly per route change. */
export function PostHogPageView() {
  const location = useLocation();

  useEffect(() => {
    const url = `${window.location.origin}${location.pathname}${location.search}`;
    capture("$pageview", { $current_url: url });
  }, [location.pathname, location.search]);

  return null;
}
