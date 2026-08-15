import { ArrowRightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "../components/DeepContentPage";
import { BrandLogo } from "../components/BrandLogo";
import { MarketingFooter, MarketingHeader, usePrimaryCta, useLandingMotion } from "../components/MarketingChrome";
import { AGENTS } from "../content/agents";

export function AgentsHubPage() {
  useLandingMotion();
  const primary = usePrimaryCta();

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">Skip to content</a>
      <MarketingHeader />

      <main id="main-content">
        <section className="deep-hero" aria-labelledby="agents-hub-title">
          <div className="landing-hero-glow landing-hero-glow-a" aria-hidden="true" />
          <Breadcrumbs trail={[{ label: "Home", href: "/" }, { label: "Agents" }]} />
          <div className="deep-hero-copy" data-reveal>
            <p className="landing-kicker"><span /> The specialist crew</p>
            <h1 className="landing-title" id="agents-hub-title">
              Eight specialists.<br />
              <span>One coordinated crew.</span>
            </h1>
            <p className="landing-sub">
              Every Teamvinsible project routes through some combination of these eight agents, coordinated by
              Nexus. Open a role to see exactly what it does, how it works, and when it's the one you need.
            </p>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="agents-grid-title">
          <h2 className="sr-only" id="agents-grid-title">All specialist agents</h2>
          <div className="features-grid">
            {AGENTS.map((agent) => (
              <Link className="feature-card" key={agent.slug} to={`/agents/${agent.slug}`} data-reveal>
                <div className="feature-card-top"><span>{agent.breadcrumbLabel.replace(" Agent", "")}</span><i>↗</i></div>
                <h3>{agent.heroTitleLines.join(" ")}</h3>
                <p>{agent.heroSub}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="agents-final-title">
          <div className="landing-final-grid" aria-hidden="true" />
          <div data-reveal>
            <BrandLogo compact />
            <p>YOUR NEXT MOVE, COORDINATED</p>
            <h2 id="agents-final-title">Bring the idea.<br /><em>We'll bring the crew.</em></h2>
            <Link to={primary.href} onClick={() => primary.track("agents_hub_final")}>
              <Button type="primary" size="large">{primary.label} <ArrowRightOutlined /></Button>
            </Link>
            <small>No black box. No lost context. Just visible progress.</small>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
