import { ArrowLeftOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  route: "/terms" | "/privacy";
  intro: string;
  sections: LegalSection[];
};

const EFFECTIVE_DATE = "July 19, 2026";

const termsSections: LegalSection[] = [
  {
    title: "1. Acceptance of these Terms",
    paragraphs: [
      "These Terms of Service govern your access to and use of Teamvinsible’s websites, applications, AI-agent coordination tools, previews, publishing tools, and related services (the “Service”). By creating an account, accessing, or using the Service, you agree to these Terms. If you use the Service for an organization, you represent that you have authority to bind that organization.",
      "If you do not agree to these Terms, do not use the Service.",
    ],
  },
  {
    title: "2. Eligibility and accounts",
    paragraphs: [
      "You must be at least 18 years old and legally capable of entering into a binding contract. You must provide accurate account information, keep your credentials secure, and promptly notify us of suspected unauthorized access. You are responsible for activity performed through your account and workspace.",
    ],
  },
  {
    title: "3. The Service and AI-generated work",
    paragraphs: [
      "Teamvinsible coordinates AI agents that may research, plan, write, design, generate code, review work, create artifacts, and prepare previews or deployments. AI-generated results can be incomplete, inaccurate, non-unique, or unsuitable for your intended use.",
      "You are responsible for reviewing outputs, testing code, validating facts, obtaining professional advice where appropriate, and deciding whether to use or publish any result. The Service is not a substitute for legal, financial, medical, security, or other professional advice.",
    ],
  },
  {
    title: "4. Your content and workspaces",
    paragraphs: [
      "You retain ownership of content you submit to the Service, including briefs, prompts, files, source materials, and project data (“Your Content”). You grant Teamvinsible a limited, worldwide, non-exclusive license to host, copy, process, transmit, display, and modify Your Content only as needed to operate, secure, support, and improve the Service.",
      "You represent that you have the rights and permissions necessary to submit Your Content and to instruct us and our service providers to process it. You remain responsible for Your Content and for any product, website, campaign, or other material you publish using the Service.",
    ],
  },
  {
    title: "5. Acceptable use",
    paragraphs: ["You may not use the Service to:"],
    bullets: [
      "violate law, regulation, contractual obligations, privacy rights, intellectual-property rights, or other rights;",
      "create or distribute malware, phishing, deceptive content, unlawful surveillance, or systems intended to cause harm;",
      "attempt to gain unauthorized access, bypass safeguards, probe vulnerabilities, or disrupt the Service;",
      "submit secrets, regulated data, or highly sensitive personal information unless Teamvinsible has expressly agreed to support that use;",
      "misrepresent AI-generated work as independently verified, or use it to make prohibited automated decisions about individuals;",
      "resell, reverse engineer, scrape, or systematically extract the Service except where expressly permitted by law or a written agreement.",
    ],
  },
  {
    title: "6. Outputs and intellectual property",
    paragraphs: [
      "As between you and Teamvinsible, and to the extent permitted by law, you may use outputs generated specifically for you. Because AI systems can produce similar results for different users, outputs may not be unique and Teamvinsible does not guarantee that an output is eligible for intellectual-property protection or free from third-party claims.",
      "Teamvinsible and its licensors retain all rights in the Service, software, coordination methods, interfaces, branding, documentation, and underlying technology. If you provide feedback, you permit us to use it without restriction or compensation.",
    ],
  },
  {
    title: "7. Third-party services",
    paragraphs: [
      "The Service relies on third-party infrastructure, authentication, AI-model, repository, deployment, and other providers. Your use of connected third-party services may be governed by their own terms and privacy policies. Teamvinsible is not responsible for third-party services outside our control.",
    ],
  },
  {
    title: "8. Fees and changes",
    paragraphs: [
      "Some features may be offered free, in preview, or for a fee. If paid plans are introduced or selected, prices, billing intervals, renewal terms, taxes, and cancellation rules will be disclosed before purchase. We may change, add, suspend, or discontinue features, and will provide notice when required by law or when a change materially affects a paid commitment.",
    ],
  },
  {
    title: "9. Suspension and termination",
    paragraphs: [
      "You may stop using the Service at any time. We may limit, suspend, or terminate access when reasonably necessary to address security risk, unlawful activity, material breach, non-payment, harm to other users, or operational requirements. Where practicable, we will provide notice and an opportunity to export Your Content before termination.",
    ],
  },
  {
    title: "10. Disclaimers",
    paragraphs: [
      "To the maximum extent permitted by law, the Service is provided “as is” and “as available.” Teamvinsible disclaims implied warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted or error-free operation. We do not warrant the accuracy, legality, security, or suitability of AI-generated outputs.",
    ],
  },
  {
    title: "11. Limitation of liability",
    paragraphs: [
      "To the maximum extent permitted by law, Teamvinsible and its affiliates, officers, employees, and suppliers will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue, data, goodwill, or business opportunity arising from the Service.",
      "Our aggregate liability for claims relating to the Service will not exceed the greater of the amount you paid Teamvinsible for the Service during the 12 months before the event giving rise to the claim or USD $100. Some jurisdictions do not allow certain exclusions or limitations, so parts of this section may not apply to you.",
    ],
  },
  {
    title: "12. Indemnity",
    paragraphs: [
      "To the extent permitted by law, you will defend and indemnify Teamvinsible against third-party claims, damages, and reasonable costs arising from Your Content, your published outputs, your violation of these Terms, or your infringement of another person’s rights.",
    ],
  },
  {
    title: "13. Governing terms and disputes",
    paragraphs: [
      "These Terms are governed by the laws applicable to the Teamvinsible entity providing the Service, without regard to conflict-of-law rules. Courts with jurisdiction over that entity will have exclusive jurisdiction, except where mandatory consumer law provides otherwise. Before filing a formal claim, each party agrees to attempt to resolve the dispute informally for 30 days.",
    ],
  },
  {
    title: "14. Changes and contact",
    paragraphs: [
      "We may update these Terms to reflect changes to the Service, law, or business practices. We will update the effective date and provide additional notice when required. Continued use after an update takes effect constitutes acceptance of the revised Terms.",
      "Questions about these Terms may be sent to legal@teamvinsible.com.",
    ],
  },
];

const privacySections: LegalSection[] = [
  {
    title: "1. Information we collect",
    paragraphs: ["We collect information you provide, information generated through use of the Service, and limited technical information needed to operate it."],
    bullets: [
      "Account information, such as your name, email address, user identifier, authentication provider, and workspace preferences.",
      "Project content, including briefs, prompts, uploaded files, source materials, messages, decisions, generated artifacts, code, previews, and publishing configuration.",
      "Usage and device information, such as IP address, browser and device type, timestamps, request logs, error data, feature interactions, and security events.",
      "Communications you send to us, including support requests, feedback, and survey responses.",
    ],
  },
  {
    title: "2. How we use information",
    bullets: [
      "provide, personalize, maintain, and secure the Service;",
      "authenticate users and manage accounts, workspaces, projects, previews, and publications;",
      "route prompts and project materials to AI agents and service providers needed to complete your instructions;",
      "monitor reliability, prevent abuse, troubleshoot errors, and improve features and coordination quality;",
      "communicate about the Service, respond to requests, and send important operational or policy notices;",
      "comply with law, enforce our terms, and protect users, Teamvinsible, and the public.",
    ],
  },
  {
    title: "3. AI processing",
    paragraphs: [
      "When you ask the agent crew to perform work, relevant prompts, files, project context, and prior outputs may be processed by AI-model providers. Teamvinsible currently uses DeepSeek for live language-model inference. Do not submit information that you are not authorized to disclose or highly sensitive personal data unless we have expressly agreed to that processing.",
      "AI interactions may be logged to operate the workflow, show activity and artifacts, investigate errors, enforce safeguards, and improve the Service. We do not use Your Content to train a Teamvinsible foundation model.",
    ],
  },
  {
    title: "4. How we disclose information",
    paragraphs: ["We may disclose information to the following categories of recipients:"],
    bullets: [
      "Cloud infrastructure and security providers, including Cloudflare, used for application hosting, storage, databases, queues, sandboxing, and delivery.",
      "Authentication and account providers, including Supabase and any sign-in provider you choose.",
      "AI-model providers, including DeepSeek, when needed to perform your requested agent work.",
      "Repository, deployment, or integration providers that you choose to connect or instruct us to use.",
      "Professional advisers, authorities, or other parties when required by law or reasonably necessary to protect rights and safety.",
      "A successor in connection with a merger, financing, acquisition, reorganization, or sale of assets, subject to appropriate safeguards.",
    ],
  },
  {
    title: "5. Sale and targeted advertising",
    paragraphs: [
      "Teamvinsible does not sell personal information for money and does not share personal information for cross-context behavioral advertising. If our practices change, we will update this notice and provide any opt-out mechanism required by applicable law.",
    ],
  },
  {
    title: "6. Cookies and local storage",
    paragraphs: [
      "We use necessary cookies and browser storage for authentication, security, theme selection, workspace preferences, and core functionality. We use PostHog for product analytics, to understand aggregate usage, performance, and feature adoption. We do not currently use third-party advertising cookies on the Service.",
      "PostHog also records session replays—a reconstruction of on-screen activity such as navigation, clicks, and layout—to help us diagnose usability issues. Form field values (including any workspace content you type) are masked and are not captured in replays.",
    ],
  },
  {
    title: "7. Legal bases",
    paragraphs: [
      "Where applicable data-protection law requires a legal basis, we process information to perform our contract with you, pursue legitimate interests such as security and service improvement, comply with legal obligations, and act on your consent where consent is required. You may withdraw consent at any time without affecting earlier processing.",
    ],
  },
  {
    title: "8. Data retention",
    paragraphs: [
      "We retain account and project information while your account is active and as reasonably needed to provide the Service, meet legal obligations, resolve disputes, prevent abuse, and maintain security. Retention periods vary by data type and context. Deleted information may remain for a limited period in backups or logs before routine deletion or de-identification.",
    ],
  },
  {
    title: "9. Security",
    paragraphs: [
      "We use technical and organizational safeguards designed to protect information, including access controls, authentication, isolation, logging, and secure infrastructure providers. No method of storage or transmission is completely secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    title: "10. International transfers",
    paragraphs: [
      "Teamvinsible and its providers may process information in countries other than your own. Where required, we use recognized transfer mechanisms and contractual or organizational safeguards. Local laws in those countries may differ from the laws where you live.",
    ],
  },
  {
    title: "11. Your privacy rights",
    paragraphs: ["Depending on where you live, you may have rights to:"],
    bullets: [
      "access, correct, or delete personal information;",
      "receive a portable copy of certain information;",
      "object to or restrict certain processing;",
      "withdraw consent and opt out of certain communications;",
      "appeal a refusal of a privacy request or complain to your data-protection authority.",
    ],
  },
  {
    title: "12. Children",
    paragraphs: [
      "The Service is not directed to children under 18, and we do not knowingly collect personal information from children. If you believe a child has provided information to us, contact us so we can investigate and take appropriate action.",
    ],
  },
  {
    title: "13. Changes to this notice",
    paragraphs: [
      "We may update this Privacy Policy as the Service, providers, or legal requirements change. We will post the revised policy, update its effective date, and provide additional notice when required by law.",
    ],
  },
  {
    title: "14. Contact us",
    paragraphs: [
      "To ask a privacy question or request access, correction, deletion, or portability, email privacy@teamvinsible.com. We may need to verify your identity before completing a request. You may also contact your local data-protection authority where applicable.",
    ],
  },
];

function LegalPage({ eyebrow, title, route, intro, sections }: LegalPageProps) {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="legal-brand" aria-label="Teamvinsible home"><BrandLogo /></Link>
        <div className="legal-header-actions"><ThemeToggle /><Link to="/" className="legal-back"><ArrowLeftOutlined /> Back home</Link></div>
      </header>
      <main className="legal-main">
        <aside className="legal-aside">
          <p>{eyebrow}</p>
          <nav aria-label="Legal navigation">
            <Link to="/terms" className={route === "/terms" ? "is-active" : ""}>Terms of Service</Link>
            <Link to="/privacy" className={route === "/privacy" ? "is-active" : ""}>Privacy Policy</Link>
          </nav>
        </aside>
        <article className="legal-document">
          <div className="legal-title-block">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <div className="legal-meta"><span>Effective {EFFECTIVE_DATE}</span><span>Last updated {EFFECTIVE_DATE}</span></div>
            <p className="legal-intro">{intro}</p>
            <div className="legal-notice">This standard policy is provided for transparency and should be reviewed by qualified counsel for Teamvinsible’s final entity, jurisdiction, pricing, and production practices.</div>
          </div>
          <div className="legal-sections">
            {sections.map((section) => (
              <section key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
              </section>
            ))}
          </div>
        </article>
      </main>
      <footer className="legal-footer">
        <BrandLogo />
        <span>
          © {new Date().getFullYear()} Teamvinsible · Made with ❤️ &amp; AI by Foundrylabs in{" "}
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
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}

export function TermsPage() {
  return <LegalPage eyebrow="Legal / Terms" title="Terms of Service" route="/terms" intro="These Terms explain the rules for using Teamvinsible, the responsibilities that come with directing an AI agent crew, and the limits that protect both you and the Service." sections={termsSections} />;
}

export function PrivacyPage() {
  return <LegalPage eyebrow="Legal / Privacy" title="Privacy Policy" route="/privacy" intro="This Privacy Policy explains what information Teamvinsible processes, why we process it, which providers support the Service, and the choices and rights available to you." sections={privacySections} />;
}
