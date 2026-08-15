import { Link, useParams } from "react-router-dom";
import { DeepContentPage } from "../components/DeepContentPage";
import { getUseCase } from "../content/use-cases";

export function UseCasePage() {
  const { slug } = useParams();
  const useCase = getUseCase(slug);

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

  return (
    <DeepContentPage
      content={useCase}
      trackingId={`use_case_${useCase.slug}`}
      breadcrumbs={[{ label: "Home", href: "/" }, { label: useCase.breadcrumbLabel }]}
    />
  );
}
