import { ArrowRightOutlined, CheckOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AnalyticsEvent } from "../lib/analytics-events";
import { capture } from "../lib/analytics";
import { BrandLogo } from "../components/BrandLogo";
import { MarketingFooter, MarketingHeader, useLandingMotion } from "../components/MarketingChrome";

const crewRoles = [
  {
    glyph: "RE",
    title: "Research",
    copy: "Gathers market, competitor, and user context before a single spec is written, so the crew starts from evidence instead of assumption.",
  },
  {
    glyph: "PR",
    title: "Product",
    copy: "Turns the brief into scoped specs, acceptance criteria, and prioritized tradeoffs Nexus can route to the rest of the crew.",
  },
  {
    glyph: "BR",
    title: "Brand",
    copy: "Keeps voice, positioning, and visual identity consistent across every artifact the crew produces.",
  },
  {
    glyph: "DS",
    title: "Design",
    copy: "Shapes the interface and experience decisions that engineering builds against, reviewed before code is written.",
  },
  {
    glyph: "EN",
    title: "Engineering",
    copy: "Builds against the approved spec, pushes to a sandbox preview, and surfaces implementation tradeoffs back to the spine.",
  },
  {
    glyph: "RV",
    title: "Review",
    copy: "Checks acceptance criteria, flags gaps, and sends work back into a revision loop before it reaches you.",
  },
  {
    glyph: "SO",
    title: "Social",
    copy: "Drafts launch and channel content once the underlying product artifact is approved, so messaging matches what actually shipped.",
  },
  {
    glyph: "EM",
    title: "Email",
    copy: "Handles lifecycle and launch email copy in the same coordinated pass, not a disconnected follow-up task.",
  },
];

const spineCapabilities = [
  {
    number: "01",
    title: "Agent status, live",
    copy: "See which specialist is active, idle, or blocked at any moment—not just the final output.",
  },
  {
    number: "02",
    title: "Artifacts in one place",
    copy: "Specs, files, and decisions collect on the spine as they're produced, so nothing lives only in a chat transcript.",
  },
  {
    number: "03",
    title: "Data flows between agents",
    copy: "Inspect what one specialist handed to another and why, instead of guessing how context moved through the system.",
  },
  {
    number: "04",
    title: "Open decisions surfaced",
    copy: "Questions that need your input are called out explicitly rather than buried in agent output.",
  },
  {
    number: "05",
    title: "Revision loops built in",
    copy: "Review agents send work back with specific feedback; the loop closes inside the spine, not in a new conversation.",
  },
  {
    number: "06",
    title: "Preview before you publish",
    copy: "Move from artifact to a working sandbox preview, and publish to the edge only once it's actually ready.",
  },
];

export function FeaturesPage() {
  const { configured, session } = useAuth();
  useLandingMotion();

  const primaryHref = session ? "/dashboard" : "/signup";
  const primaryLabel = session ? "Open your workspace" : configured ? "Build with your crew" : "Create your workspace";

  const trackPrimaryCta = (location: string) =>
    capture(AnalyticsEvent.CTA_CLICKED, { cta_location: location, cta_label: primaryLabel });

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">Skip to content</a>
      <MarketingHeader />

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="features-hero-title">
          <div className="landing-hero-glow landing-hero-glow-a" aria-hidden="true" />
          <div className="landing-hero-glow landing-hero-glow-b" aria-hidden="true" />
          <div className="landing-hero-copy" data-reveal>
            <p className="landing-kicker"><span /> The coordination spine, up close</p>
            <h1 className="landing-title" id="features-hero-title">
              Eight specialists.<br />
              <span>One system that keeps them honest.</span>
            </h1>
            <p className="landing-sub">
              Nexus coordinates a full crew of specialist agents and keeps their work visible on the Coordination
              Spine—from first brief to published outcome.
            </p>
            <div className="landing-cta">
              <Link to={primaryHref} onClick={() => trackPrimaryCta("features_hero")}>
                <Button type="primary" size="large">
                  {primaryLabel} <ArrowRightOutlined />
                </Button>
              </Link>
            </div>
            <ul className="landing-trust" aria-label="Product highlights">
              <li><CheckOutlined /> Specialist agents</li>
              <li><CheckOutlined /> Visible workflows</li>
              <li><CheckOutlined /> Preview to publish</li>
            </ul>
          </div>
        </section>

        <section className="landing-section" id="crew" aria-labelledby="crew-title">
          <div className="landing-section-label" data-reveal><span>01</span> Meet the crew</div>
          <div className="features-heading" data-reveal>
            <h2 id="crew-title">Specialists, not one<br /><em>generic assistant.</em></h2>
            <p>Each role contributes the depth of its own discipline, coordinated by Nexus instead of prompted one at a time.</p>
          </div>
          <div className="features-grid">
            {crewRoles.map((role) => (
              <article className="feature-card" key={role.title} data-reveal>
                <div className="feature-card-top"><span>{role.glyph}</span><i>↗</i></div>
                <h3>{role.title}</h3>
                <p>{role.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="spine" aria-labelledby="spine-title">
          <div className="landing-section-label" data-reveal><span>02</span> The coordination spine</div>
          <div className="features-heading" data-reveal>
            <h2 id="spine-title">Every moving part.<br /><em>One visible system.</em></h2>
            <p>The spine is where agent work becomes inspectable instead of disappearing into a black box.</p>
          </div>
          <div className="features-grid">
            {spineCapabilities.map((capability) => (
              <article className="feature-card" key={capability.number} data-reveal>
                <div className="feature-card-top"><span>{capability.number}</span><i>↗</i></div>
                <h3>{capability.title}</h3>
                <p>{capability.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="features-final-title">
          <div className="landing-final-grid" aria-hidden="true" />
          <div data-reveal>
            <BrandLogo compact />
            <p>YOUR NEXT MOVE, COORDINATED</p>
            <h2 id="features-final-title">Bring the idea.<br /><em>We'll bring the crew.</em></h2>
            <Link to={primaryHref} onClick={() => trackPrimaryCta("features_final")}>
              <Button type="primary" size="large">{primaryLabel} <ArrowRightOutlined /></Button>
            </Link>
            <small>No black box. No lost context. Just visible progress.</small>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
