import { ArrowRightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { BrandLogo } from "../components/BrandLogo";
import { MarketingFooter, MarketingHeader, useLandingMotion } from "../components/MarketingChrome";
import { getUseCase } from "../content/use-cases";
import { capture } from "../lib/analytics";
import { AnalyticsEvent } from "../lib/analytics-events";

export function UseCasePage() {
  const { slug } = useParams();
  const useCase = getUseCase(slug);
  const { configured, session } = useAuth();
  useLandingMotion();

  if (!useCase) {
    return (
      <main className="page-state card" aria-labelledby="use-case-not-found-title">
        <p className="orch-kicker">404</p>
        <h1 className="page-state-title" id="use-case-not-found-title">Page not found</h1>
        <p className="muted">The page you requested does not exist or has moved.</p>
        <Link to="/" className="legal-back">Back to Teamvinsible</Link>
      </main>
    );
  }

  const primaryHref = session ? "/dashboard" : "/signup";
  const primaryLabel = session ? "Open your workspace" : configured ? "Build with your crew" : "Create your workspace";

  const trackPrimaryCta = (location: string) =>
    capture(AnalyticsEvent.CTA_CLICKED, { cta_location: location, cta_label: primaryLabel });

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">Skip to content</a>
      <MarketingHeader />

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="use-case-hero-title">
          <div className="landing-hero-glow landing-hero-glow-a" aria-hidden="true" />
          <div className="landing-hero-glow landing-hero-glow-b" aria-hidden="true" />
          <div className="landing-hero-copy" data-reveal>
            <p className="landing-kicker"><span /> {useCase.heroKicker}</p>
            <h1 className="landing-title" id="use-case-hero-title">
              {useCase.heroTitleLines[0]}<br />
              <span>{useCase.heroTitleLines[1]}</span>
            </h1>
            <p className="landing-sub">{useCase.heroSub}</p>
            <div className="landing-cta">
              <Link to={primaryHref} onClick={() => trackPrimaryCta("use_case_hero")}>
                <Button type="primary" size="large">
                  {primaryLabel} <ArrowRightOutlined />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="story-problem landing-section" id="problem">
          <div className="landing-section-label" data-reveal><span>01</span> Why {useCase.audience.toLowerCase()} use Teamvinsible</div>
          <div className="problem-cards">
            {useCase.painPoints.map((point, index) => (
              <article data-reveal key={point.label}>
                <span>{point.label}</span>
                <strong>{point.detail}</strong>
                <i>{String(index + 1).padStart(2, "0")}</i>
              </article>
            ))}
          </div>
        </section>

        <section className="story-flow landing-section" aria-labelledby="use-case-scenario-title">
          <div className="landing-section-label" data-reveal><span>02</span> {useCase.scenarioTitle}</div>
          <div className="story-flow-heading" data-reveal>
            <h2 id="use-case-scenario-title">From brief to outcome,<br /><em>coordinated for {useCase.audience.toLowerCase()}.</em></h2>
            <p>{useCase.scenario}</p>
          </div>
        </section>

        <section className="faq-section landing-section" id="faq" aria-labelledby="use-case-faq-title">
          <div className="faq-heading" data-reveal><div className="landing-section-label"><span>03</span> Answers</div><h2 id="use-case-faq-title">Questions {useCase.audience.toLowerCase()}<br /><em>actually ask.</em></h2></div>
          <div className="faq-list">
            {useCase.faqs.map((faq, index) => (
              <details key={faq.question} data-reveal open={index === 0}>
                <summary><span>{String(index + 1).padStart(2, "0")}</span>{faq.question}<i>+</i></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="use-case-final-title">
          <div className="landing-final-grid" aria-hidden="true" />
          <div data-reveal>
            <BrandLogo compact />
            <p>YOUR NEXT MOVE, COORDINATED</p>
            <h2 id="use-case-final-title">Bring the idea.<br /><em>We'll bring the crew.</em></h2>
            <Link to={primaryHref} onClick={() => trackPrimaryCta("use_case_final")}>
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
