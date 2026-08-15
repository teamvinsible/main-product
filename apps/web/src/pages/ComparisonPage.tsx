import { ArrowRightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs } from "../components/DeepContentPage";
import { BrandLogo } from "../components/BrandLogo";
import { MarketingFooter, MarketingHeader, usePrimaryCta, useLandingMotion } from "../components/MarketingChrome";
import { getComparison } from "../content/comparisons";

export function ComparisonPage() {
  const { slug } = useParams();
  const comparison = getComparison(slug);
  useLandingMotion();
  const primary = usePrimaryCta();

  if (!comparison) {
    return (
      <main className="page-state card" aria-labelledby="comparison-not-found-title">
        <p className="orch-kicker">404</p>
        <h1 className="page-state-title" id="comparison-not-found-title">Page not found</h1>
        <p className="muted">The page you requested does not exist or has moved.</p>
        <Link to="/" className="legal-back">Back to Teamvinsible</Link>
      </main>
    );
  }

  const trackingId = `vs_${comparison.slug}`;

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">Skip to content</a>
      <MarketingHeader />

      <main id="main-content">
        <section className="deep-hero" aria-labelledby="vs-hero-title">
          <div className="landing-hero-glow landing-hero-glow-a" aria-hidden="true" />
          <Breadcrumbs trail={[{ label: "Home", href: "/" }, { label: comparison.breadcrumbLabel }]} />
          <div className="deep-hero-copy" data-reveal>
            <p className="landing-kicker"><span /> {comparison.eyebrow}</p>
            <h1 className="landing-title" id="vs-hero-title">
              {comparison.heroTitleLines[0]}<br />
              <span>{comparison.heroTitleLines[1]}</span>
            </h1>
            <p className="landing-sub">{comparison.heroSub}</p>
            <div className="landing-cta">
              <Link to={primary.href} onClick={() => primary.track(`${trackingId}_hero`)}>
                <Button type="primary" size="large">
                  {primary.label} <ArrowRightOutlined />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="deep-body landing-section" aria-labelledby="vs-table-title">
          <div className="deep-article" data-reveal style={{ maxWidth: 860, margin: "0 auto" }}>
            <p className="deep-intro">{comparison.intro}</p>
            <h2 id="vs-table-title">Side by side</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Dimension</th>
                    <th>Them</th>
                    <th>Teamvinsible</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.comparisonRows.map((row) => (
                    <tr key={row.dimension}>
                      <td>{row.dimension}</td>
                      <td>{row.them}</td>
                      <td>{row.us}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2>When Teamvinsible is the better fit</h2>
            <ul className="deep-solves">
              {comparison.whenTeamvinsibleWins.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <h2>When it might not be</h2>
            <ul className="deep-solves">
              {comparison.whenTheyWin.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="faq-section landing-section" id="faq" aria-labelledby="vs-faq-title">
          <div className="faq-heading" data-reveal>
            <div className="landing-section-label">FAQ</div>
            <h2 id="vs-faq-title">Questions about<br /><em>this comparison.</em></h2>
          </div>
          <div className="faq-list">
            {comparison.faqs.map((faq, index) => (
              <details key={faq.question} data-reveal open={index === 0}>
                <summary><span>{String(index + 1).padStart(2, "0")}</span>{faq.question}<i>+</i></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="vs-final-title">
          <div className="landing-final-grid" aria-hidden="true" />
          <div data-reveal>
            <BrandLogo compact />
            <p>YOUR NEXT MOVE, COORDINATED</p>
            <h2 id="vs-final-title">Bring the idea.<br /><em>We'll bring the crew.</em></h2>
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
