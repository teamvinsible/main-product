import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { DeepContentPage } from "../components/DeepContentPage";
import { getAgent } from "../content/agents";

export function AgentPage() {
  const { slug } = useParams();
  const agent = getAgent(slug);

  if (!agent) {
    return (
      <main className="page-state card" aria-labelledby="agent-not-found-title">
        <p className="orch-kicker">404</p>
        <h1 className="page-state-title" id="agent-not-found-title">Page not found</h1>
        <p className="muted">The page you requested does not exist or has moved.</p>
        <Link to="/agents" className="legal-back">Back to agents</Link>
      </main>
    );
  }

  return (
    <DeepContentPage
      content={agent}
      trackingId={`agent_${agent.slug}`}
      breadcrumbs={[
        { label: "Home", href: "/" },
        { label: "Agents", href: "/agents" },
        { label: agent.breadcrumbLabel },
      ]}
    />
  );
}
