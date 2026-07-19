import { Alert, Button, Form, Input } from "antd";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { BrandLogo } from "../components/BrandLogo";

export function SignupPage() {
  const { configured, session, signInGoogle, signUpEmail } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/dashboard" replace />;

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

  async function onEmail(values: { name?: string; email: string; password: string }) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await signUpEmail(values.email, values.password, values.name);
      setInfo("Check your email to confirm, or sign in if confirmation is disabled.");
      navigate("/dashboard");
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
        <h1>Create your workspace</h1>
        <p className="auth-lead">Google or email — then hand work to Nexus.</p>

        {!configured && (
          <Alert
            type="info"
            showIcon
            message="Supabase is not configured"
            description="Add VITE_SUPABASE_* env vars to enable signup."
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
          <Form.Item name="name" label="Display name">
            <Input size="large" autoComplete="name" placeholder="Alex" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input size="large" autoComplete="email" placeholder="you@company.com" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password size="large" autoComplete="new-password" />
          </Form.Item>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
          {info && <Alert type="success" showIcon message={info} style={{ marginBottom: 12 }} />}
          <Button type="primary" htmlType="submit" size="large" block loading={busy} disabled={!configured}>
            Sign up
          </Button>
        </Form>

        <p className="auth-legal">
          By creating an account, you agree to our <Link to="/terms">Terms of Service</Link> and acknowledge our <Link to="/privacy">Privacy Policy</Link>.
        </p>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
