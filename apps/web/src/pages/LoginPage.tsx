import { Alert, Button, Form, Input } from "antd";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { BrandLogo } from "../components/BrandLogo";

export function LoginPage() {
  const { configured, session, signInGoogle, signInEmail } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/dashboard";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={from} replace />;

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function onEmail(values: { email: string; password: string }) {
    setBusy(true);
    setError(null);
    try {
      await signInEmail(values.email, values.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <Link to="/" className="auth-brand">
          <BrandLogo />
        </Link>
        <h1>Welcome back</h1>
        <p className="auth-lead">Sign in to coordinate your agent crew.</p>

        {!configured && (
          <Alert
            type="info"
            showIcon
            message="Supabase is not configured"
            description="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or use demo mode from the landing page."
            style={{ marginBottom: 16 }}
          />
        )}

        <Button
          type="default"
          size="large"
          block
          loading={busy}
          disabled={!configured}
          onClick={onGoogle}
          className="auth-google"
        >
          Continue with Google
        </Button>

        <div className="auth-divider">
          <span>or email</span>
        </div>

        <Form layout="vertical" onFinish={onEmail} requiredMark={false}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input size="large" autoComplete="email" placeholder="you@company.com" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
          <Button type="primary" htmlType="submit" size="large" block loading={busy} disabled={!configured}>
            Sign in
          </Button>
        </Form>

        <p className="auth-footer">
          No account? <Link to="/signup">Sign up</Link>
          {" · "}
          <Link to="/">Back home</Link>
        </p>
      </div>
    </div>
  );
}
