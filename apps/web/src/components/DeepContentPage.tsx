import { ArrowRightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Link } from "react-router-dom";
import { BrandLogo } from "./BrandLogo";
import { MarketingFooter, MarketingHeader, usePrimaryCta, useLandingMotion } from "./MarketingChrome";
import type { DeepPageContent } from "../content/deep-content";

type Breadcrumb = { label: string; href?: string };

export function Breadcrumbs({ trail }: { trail: Breadcrumb[] }) {
  return (
    <nav className="deep-breadcrumb" aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <span key={crumb.label}>
          {crumb.href ? <Link to={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
          {index < trail.length - 1 && <i>/</i>}
        </span>
      ))}
    </nav>
  );
}

export function DeepContentPage({
  content,
  breadcrumbs,
  trackingId,
}: {
  content: DeepPageContent;
  breadcrumbs: Breadcrumb[];
  trackingId: string;
}) {
  useLandingMotion();
  const primary = usePrimaryCta();

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">Skip to content</a>
      <MarketingHeader />

      <main id="main-content">
        <section className="deep-hero" aria-labelledby="deep-hero-title">
          <div className="landing-hero-glow landing-hero-glow-a" aria-hidden="true" />
          <Breadcrumbs trail={breadcrumbs} />
          <div className="deep-hero-copy" data-reveal>
            <p className="landing-kicker"><span /> {content.eyebrow}</p>
            <h1 className="landing-title" id="deep-hero-title">
              {content.heroTitleLines[0]}<br />
              <span>{content.heroTitleLines[1]}</span>
            </h1>
            <p className="landing-sub">{content.heroSub}</p>
            <div className="landing-cta">
              <Link to={primary.href} onClick={() => primary.track(`${trackingId}_hero`)}>
                <Button type="primary" size="large">
                  {primary.label} <ArrowRightOutlined />
                </Button>
              </Link>
            </div>
            {content.highlights.length > 0 && (
              <ul className="deep-highlights">
                {content.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="deep-body landing-section" aria-labelledby="deep-body-title">
          <h2 className="sr-only" id="deep-body-title">{content.breadcrumbLabel} details</h2>
          <div className="deep-grid">
            <article className="deep-article" data-reveal>
              <p className="deep-intro">{content.intro}</p>

              {content.howItWorks.length > 0 && (
                <>
                  <h2>How it works</h2>
                  <ol className="deep-steps">
                    {content.howItWorks.map((step, index) => (
                      <li key={step.title}>
                        <span className="deep-step-number">{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{step.title}</strong>
                          <p>{step.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {content.whatItSolves.length > 0 && (
                <>
                  <h2>What it solves</h2>
                  <ul className="deep-solves">
                    {content.whatItSolves.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}

              <h2>Before / after</h2>
              <div className="deep-before-after">
                <div>
                  <p className="deep-before-after-label">{content.beforeAfter.beforeLabel}</p>
                  <p>{content.beforeAfter.before}</p>
                </div>
                <div className="is-after">
                  <p className="deep-before-after-label">{content.beforeAfter.afterLabel}</p>
                  <p>{content.beforeAfter.after}</p>
                </div>
              </div>

              {content.whenToUse.length > 0 && (
                <>
                  <h2>When to use it</h2>
                  <div className="deep-scenarios">
                    {content.whenToUse.map((scenario) => (
                      <p key={scenario.label}>
                        <strong>{scenario.label}</strong> — {scenario.detail}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </article>

            <aside className="deep-sidebar" data-reveal>
              <div className="deep-sidebar-card is-cta">
                <p className="deep-sidebar-eyebrow">Start in seconds</p>
                <Link to={primary.href} onClick={() => primary.track(`${trackingId}_sidebar`)} className="deep-sidebar-cta-link">
                  {primary.label} <ArrowRightOutlined />
                </Link>
              </div>

              {content.bestFor.length > 0 && (
                <div className="deep-sidebar-card">
                  <p className="deep-sidebar-eyebrow">Best for</p>
                  <ul>
                    {content.bestFor.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {content.relatedLinks.length > 0 && (
                <div className="deep-sidebar-card">
                  <p className="deep-sidebar-eyebrow">Related</p>
                  <ul className="deep-sidebar-links">
                    {content.relatedLinks.map((link) => (
                      <li key={link.href}><Link to={link.href}>{link.label}</Link></li>
                    ))}
                  </ul>
                </div>
              )}

              {content.keywords.length > 0 && (
                <div className="deep-sidebar-card">
                  <p className="deep-sidebar-eyebrow">Related searches</p>
                  <div className="deep-keyword-chips">
                    {content.keywords.map((keyword) => (
                      <span key={keyword}>{keyword}</span>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className="faq-section landing-section" id="faq" aria-labelledby="deep-faq-title">
          <div className="faq-heading" data-reveal>
            <div className="landing-section-label">FAQ</div>
            <h2 id="deep-faq-title">Questions about<br /><em>{content.breadcrumbLabel.toLowerCase()}.</em></h2>
          </div>
          <div className="faq-list">
            {content.faqs.map((faq, index) => (
              <details key={faq.question} data-reveal open={index === 0}>
                <summary><span>{String(index + 1).padStart(2, "0")}</span>{faq.question}<i>+</i></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="deep-final-title">
          <div className="landing-final-grid" aria-hidden="true" />
          <div data-reveal>
            <BrandLogo compact />
            <p>YOUR NEXT MOVE, COORDINATED</p>
            <h2 id="deep-final-title">Bring the idea.<br /><em>We'll bring the crew.</em></h2>
            <Link to={primary.href} onClick={() => primary.track(`${trackingId}_final`)}>
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
