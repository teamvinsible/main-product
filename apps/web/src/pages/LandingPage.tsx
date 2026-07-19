import { ArrowRightOutlined, CheckOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";

const crew = ["Research", "Product", "Brand", "Design", "Engineering", "Review", "Social", "Email"];

const features = [
  {
    number: "01",
    title: "A Nexus that keeps the plot",
    copy: "One coordinating intelligence turns your brief into a plan, routes work to the right specialists, and keeps every handoff connected.",
    detail: "Plan · route · reconcile",
  },
  {
    number: "02",
    title: "Specialists, not one generic chat",
    copy: "Research, product, brand, engineering, review, social, and email agents each contribute the depth of their own discipline.",
    detail: "8 focused roles",
  },
  {
    number: "03",
    title: "The work stays visible",
    copy: "See the specs, decisions, artifacts, activity, and agent-to-agent data flows behind the result—while the work is happening.",
    detail: "No black box",
  },
  {
    number: "04",
    title: "Revision is part of the system",
    copy: "Feedback loops are explicit. Agents review, challenge, and improve each other’s work before it reaches you.",
    detail: "Built-in review loops",
  },
  {
    number: "05",
    title: "Preview before you publish",
    copy: "Move from artifacts to a working sandbox preview, inspect the outcome, and publish when it is actually ready.",
    detail: "Sandbox → edge",
  },
  {
    number: "06",
    title: "One spine for the whole project",
    copy: "Health, status, files, open decisions, and launch progress live in one calm workspace instead of across a dozen tools.",
    detail: "One source of truth",
  },
];

const faqs = [
  {
    question: "What is Teamvinsible?",
    answer: "Teamvinsible is an AI agent coordination platform that turns a brief into planned, reviewed, and publishable work. Nexus coordinates specialist agents while you retain visibility into their specs, files, decisions, and progress.",
  },
  {
    question: "How is Teamvinsible different from an AI app builder?",
    answer: "Most AI app builders optimize for a fast output from a single interface. Teamvinsible coordinates a cross-functional crew, exposes the work behind the output, and includes structured review, revision, preview, and publishing steps.",
  },
  {
    question: "Which AI agents are included?",
    answer: "A project can involve Research, Product, Brand, Design, Engineering, Review, Social, and Email specialists, with Nexus coordinating the right roles for the brief.",
  },
  {
    question: "Can I see what the agents are doing?",
    answer: "Yes. The Coordination Spine shows agent status, artifacts, data flows, activity, open decisions, revision loops, project health, and preview or publish state.",
  },
  {
    question: "Who is Teamvinsible for?",
    answer: "It is designed for founders, product teams, agencies, and small teams that need to move from idea to execution without hiring or manually coordinating every specialist role from day one.",
  },
];

function AgentGlyph({ label }: { label: string }) {
  return <span className="story-agent-glyph">{label.slice(0, 2).toUpperCase()}</span>;
}

export function LandingPage() {
  const { configured, session } = useAuth();

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

  const primaryHref = session ? "/dashboard" : "/signup";
  const primaryLabel = session ? "Open your workspace" : configured ? "Build with your crew" : "Create your workspace";

  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">Skip to content</a>
      <header className="landing-top">
        <Link to="/" className="landing-brand" aria-label="Teamvinsible home">
          <BrandLogo />
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Capabilities</a>
          <a href="#difference">Why different</a>
          <a href="#faq">FAQ</a>
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

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-hero-glow landing-hero-glow-a" aria-hidden="true" />
          <div className="landing-hero-glow landing-hero-glow-b" aria-hidden="true" />
          <div className="landing-hero-copy" data-reveal>
            <p className="landing-kicker"><span /> AI agent coordination platform</p>
            <h1 className="landing-title" id="hero-title">
              One brief.<br />
              <span>A whole crew in motion.</span>
            </h1>
            <p className="landing-sub">
              Teamvinsible turns your idea into coordinated execution. Nexus leads specialist AI agents across research, product, brand, engineering, and launch—while you see every decision, artifact, and revision.
            </p>
            <div className="landing-cta">
              <Link to={primaryHref}>
                <Button type="primary" size="large">
                  {primaryLabel} <ArrowRightOutlined />
                </Button>
              </Link>
              {!session && (
                configured ? (
                  <Link to="/login">
                    <Button size="large" icon={<PlayCircleOutlined />}>Sign in</Button>
                  </Link>
                ) : (
                  <Button size="large" icon={<PlayCircleOutlined />}>
                    Explore the demo
                  </Button>
                )
              )}
            </div>
            <ul className="landing-trust" aria-label="Product highlights">
              <li><CheckOutlined /> Specialist agents</li>
              <li><CheckOutlined /> Visible workflows</li>
              <li><CheckOutlined /> Preview to publish</li>
            </ul>
          </div>
          <div className="landing-hero-visual" data-reveal aria-label="Illustration of Nexus coordinating specialist AI agents">
            <div className="agent-window">
              <div className="agent-window-top">
                <span className="window-dots"><i /><i /><i /></span>
                <span>coordination spine / live</span>
                <span className="window-status">● running</span>
              </div>
              <div className="agent-window-body">
                <div className="agent-sidebar">
                  <span className="agent-sidebar-active" />
                  <span /><span /><span /><span />
                </div>
                <div className="agent-canvas">
                  <span className="agent-line line-a" />
                  <span className="agent-line line-b" />
                  <span className="agent-line line-c" />
                  <div className="agent-node agent-node-product"><AgentGlyph label="Product" /><small>Product</small></div>
                  <div className="agent-node agent-node-brand"><AgentGlyph label="Brand" /><small>Brand</small></div>
                  <div className="agent-node agent-node-engineering"><AgentGlyph label="Engineering" /><small>Engineering</small></div>
                  <div className="agent-node agent-node-review"><AgentGlyph label="Review" /><small>Review</small></div>
                  <div className="agent-mediator">
                    <span className="agent-mediator-pulse" />
                    <BrandLogo compact />
                    <strong>Nexus</strong>
                    <small>Coordinating 8 agents</small>
                  </div>
                </div>
                <div className="agent-activity">
                  <p><span>Product</span> Spec ready for review <time>now</time></p>
                  <p><span>Review</span> Checking acceptance criteria <time>now</time></p>
                  <p><span>Engineering</span> Building preview <time>2m</time></p>
                </div>
              </div>
            </div>
            <div className="floating-artifact floating-artifact-a"><span>SPEC</span><strong>Product brief</strong><small>Ready for review</small></div>
            <div className="floating-artifact floating-artifact-b"><span>LIVE</span><strong>Preview ready</strong><small>Open sandbox ↗</small></div>
          </div>
          <a className="landing-scroll-cue" href="#problem" aria-label="Scroll to learn more"><span /> Follow the work</a>
        </section>

        <section className="landing-marquee" aria-label="Teamvinsible agent crew">
          <div className="landing-marquee-track">
            {[...crew, ...crew].map((role, index) => <span key={`${role}-${index}`}><i /> {role}</span>)}
          </div>
        </section>

        <section className="story-problem landing-section" id="problem">
          <div className="landing-section-label" data-reveal><span>01</span> The problem</div>
          <div className="story-problem-grid">
            <h2 data-reveal>AI made output instant.<br /><em>Coordination is still the bottleneck.</em></h2>
            <div className="story-problem-copy" data-reveal>
              <p>A fast answer is not the same as a finished product. Real work crosses disciplines, carries context, survives review, and moves toward a launch.</p>
              <p>When one chat tries to do everything, decisions disappear, quality becomes inconsistent, and you become the human middleware between disconnected tools.</p>
            </div>
          </div>
          <div className="problem-cards">
            <article data-reveal><span>Fragmented</span><strong>Context scattered across chats, docs, and tabs</strong><i>01</i></article>
            <article data-reveal><span>Opaque</span><strong>An answer arrives, but the reasoning trail does not</strong><i>02</i></article>
            <article data-reveal><span>Unfinished</span><strong>Generation stops where execution should begin</strong><i>03</i></article>
          </div>
        </section>

        <section className="story-flow landing-section" id="how-it-works" aria-labelledby="flow-title">
          <div className="landing-section-label" data-reveal><span>02</span> How it works</div>
          <div className="story-flow-heading" data-reveal>
            <h2 id="flow-title">From raw idea to live outcome,<br /><em>without losing the thread.</em></h2>
            <p>Teamvinsible gives your project a coordination spine: one continuous, inspectable path from intent to execution.</p>
          </div>
          <div className="story-timeline">
            <article className="story-step" data-reveal>
              <div className="story-step-number">01</div>
              <div className="story-step-copy"><p>Brief</p><h3>Say what you want to make.</h3><span>Describe the goal, attach context, choose the crew, and let Nexus shape a shared plan.</span></div>
              <div className="story-step-visual brief-visual"><span className="typing-line typing-line-a" /><span className="typing-line typing-line-b" /><span className="typing-line typing-line-c" /><i>→</i></div>
            </article>
            <article className="story-step is-reverse" data-reveal>
              <div className="story-step-number">02</div>
              <div className="story-step-copy"><p>Coordinate</p><h3>The right specialists get to work.</h3><span>Nexus delegates, sequences, and reconnects each contribution so every agent works from the same intent.</span></div>
              <div className="story-step-visual coordinate-visual"><span className="coordinate-core">M</span>{["R", "P", "B", "E"].map((item) => <i key={item}>{item}</i>)}</div>
            </article>
            <article className="story-step" data-reveal>
              <div className="story-step-number">03</div>
              <div className="story-step-copy"><p>Review</p><h3>See the work improve, not just appear.</h3><span>Artifacts, decisions, and feedback loops stay visible. Review agents catch gaps while you remain in control.</span></div>
              <div className="story-step-visual review-visual"><span><CheckOutlined /></span><div><i /><i /><i /></div><b>Approved</b></div>
            </article>
            <article className="story-step is-reverse" data-reveal>
              <div className="story-step-number">04</div>
              <div className="story-step-copy"><p>Ship</p><h3>Move from plan to something real.</h3><span>Inspect a working sandbox preview, track project health, and publish to the edge when the outcome is ready.</span></div>
              <div className="story-step-visual ship-visual"><div><span /><span /><span /></div><b>teamvinsible.com</b><i>Live</i></div>
            </article>
          </div>
        </section>

        <section className="landing-features landing-section" id="features" aria-labelledby="features-title">
          <div className="landing-section-label" data-reveal><span>03</span> The coordination spine</div>
          <div className="features-heading" data-reveal>
            <h2 id="features-title">Every moving part.<br /><em>One visible system.</em></h2>
            <p>Autonomy where it accelerates the work. Transparency where it earns your trust.</p>
          </div>
          <div className="features-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.number} data-reveal>
                <div className="feature-card-top"><span>{feature.number}</span><i>↗</i></div>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
                <small>{feature.detail}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="difference-section landing-section" id="difference" aria-labelledby="difference-title">
          <div className="landing-section-label" data-reveal><span>04</span> Why Teamvinsible</div>
          <div className="difference-layout">
            <div className="difference-copy" data-reveal>
              <h2 id="difference-title">Not another<br />black-box builder.</h2>
              <p>Teamvinsible is designed for consequential work—the kind that needs more than a clever first draft.</p>
              <Link to={primaryHref} className="text-link">Put your crew to work <ArrowRightOutlined /></Link>
            </div>
            <div className="difference-table" data-reveal role="table" aria-label="Comparison of one-shot AI tools and Teamvinsible">
              <div className="difference-row difference-head" role="row"><span role="columnheader">One-shot AI</span><span role="columnheader">Teamvinsible</span></div>
              <div className="difference-row" role="row"><span role="cell">One generic assistant</span><strong role="cell">A coordinated specialist crew</strong></div>
              <div className="difference-row" role="row"><span role="cell">Final output only</span><strong role="cell">Visible specs, files, and decisions</strong></div>
              <div className="difference-row" role="row"><span role="cell">You manage every handoff</span><strong role="cell">Nexus carries context forward</strong></div>
              <div className="difference-row" role="row"><span role="cell">Feedback starts another chat</span><strong role="cell">Revision loops stay inside the work</strong></div>
              <div className="difference-row" role="row"><span role="cell">Stops at generation</span><strong role="cell">Continues through preview and publish</strong></div>
            </div>
          </div>
        </section>

        <section className="outcomes-section landing-section" aria-labelledby="outcomes-title">
          <div className="outcomes-orbit" aria-hidden="true"><BrandLogo compact /><span className="outcome-dot dot-a" /><span className="outcome-dot dot-b" /><span className="outcome-dot dot-c" /></div>
          <div className="outcomes-copy" data-reveal>
            <p>The difference it makes</p>
            <h2 id="outcomes-title">You stop being the workflow.<br /><em>You start directing the outcome.</em></h2>
          </div>
          <div className="outcome-list">
            <article data-reveal><span>01</span><h3>Move with a smaller team</h3><p>Bring cross-functional thinking into the room before every role is a full-time hire.</p></article>
            <article data-reveal><span>02</span><h3>Make better decisions sooner</h3><p>See competing perspectives, open questions, and quality checks while change is still inexpensive.</p></article>
            <article data-reveal><span>03</span><h3>Keep momentum after the idea</h3><p>Turn strategy into artifacts, artifacts into previews, and previews into work that can ship.</p></article>
          </div>
        </section>

        <section className="faq-section landing-section" id="faq" aria-labelledby="faq-title">
          <div className="faq-heading" data-reveal><div className="landing-section-label"><span>05</span> Answers</div><h2 id="faq-title">Questions, meet<br /><em>straight answers.</em></h2></div>
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <details key={faq.question} data-reveal open={index === 0}>
                <summary><span>{String(index + 1).padStart(2, "0")}</span>{faq.question}<i>+</i></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <div className="landing-final-grid" aria-hidden="true" />
          <div data-reveal>
            <BrandLogo compact />
            <p>YOUR NEXT MOVE, COORDINATED</p>
            <h2 id="final-title">Bring the idea.<br /><em>We’ll bring the crew.</em></h2>
            <Link to={primaryHref}><Button type="primary" size="large">{primaryLabel} <ArrowRightOutlined /></Button></Link>
            <small>No black box. No lost context. Just visible progress.</small>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <Link to="/" aria-label="Teamvinsible home"><BrandLogo /></Link>
        <p>AI agent coordination for ambitious teams.</p>
        <nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="#features">Capabilities</a><a href="#faq">FAQ</a><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/login">Sign in</Link></nav>
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
    </div>
  );
}
