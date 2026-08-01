import { useEffect } from "react";
import { Button } from "antd";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { BrandLogo } from "./BrandLogo";
import { ThemeToggle } from "./ThemeToggle";

/** Scroll-in reveal for `[data-reveal]` elements plus the cursor-following glow field on `.landing`. */
export function useLandingMotion() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8%" },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const landing = document.querySelector<HTMLElement>(".landing");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!landing || !finePointer.matches || reducedMotion.matches) return;

    let frame = 0;
    const moveAttentionField = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        landing.style.setProperty("--cursor-x", `${event.clientX}px`);
        landing.style.setProperty("--cursor-y", `${event.clientY}px`);
        landing.style.setProperty("--cursor-opacity", "1");
      });
    };
    const hideAttentionField = () => landing.style.setProperty("--cursor-opacity", "0");

    window.addEventListener("pointermove", moveAttentionField, { passive: true });
    document.documentElement.addEventListener("mouseleave", hideAttentionField);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", moveAttentionField);
      document.documentElement.removeEventListener("mouseleave", hideAttentionField);
    };
  }, []);
}

const NAV_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#difference", label: "Why different" },
  { href: "/#faq", label: "FAQ" },
];

export function MarketingHeader() {
  const { session } = useAuth();

  return (
    <header className="landing-top">
      <Link to="/" className="landing-brand" aria-label="Teamvinsible home">
        <BrandLogo />
      </Link>
      <nav className="landing-nav" aria-label="Main navigation">
        {NAV_LINKS.map((link) => (
          <a key={link.href} href={link.href}>{link.label}</a>
        ))}
      </nav>
      <div className="landing-top-actions">
        <ThemeToggle />
        {session ? (
          <Link to="/dashboard">
            <Button type="primary">Open workspace</Button>
          </Link>
        ) : (
          <>
            <Link to="/login">
              <Button type="text">Sign in</Button>
            </Link>
            <Link to="/signup">
              <Button type="primary">Start building</Button>
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="landing-footer">
      <Link to="/" aria-label="Teamvinsible home"><BrandLogo /></Link>
      <p>AI agent coordination for ambitious teams.</p>
      <nav aria-label="Footer navigation">
        <Link to="/features">Features</Link>
        <a href="/#how-it-works">How it works</a>
        <a href="/#faq">FAQ</a>
        <Link to="/for/founders">Founders</Link>
        <Link to="/for/agencies">Agencies</Link>
        <Link to="/for/product-teams">Product teams</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/login">Sign in</Link>
      </nav>
      <small>
        © {new Date().getFullYear()} Teamvinsible
        <span className="footer-credit">
          Made with ❤️ &amp; AI by Foundrylabs in{" "}
          <img
            className="footer-flag"
            src="/flag-india.svg"
            alt="India"
            width={18}
            height={12}
            loading="lazy"
            decoding="async"
          />
        </span>
      </small>
    </footer>
  );
}
