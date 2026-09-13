import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { authApi } from "./auth-client.js";
import ProductMark from "./ProductMark.jsx";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function AccountGate({ mode, onSubmit, busy, error }) {
  const setup = mode === "setup";
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = setup && confirm && password !== confirm;

  return (
    <main className="account-gate" data-account-gate={mode}>
      <section className="account-gate__card" aria-labelledby="account-gate-title">
        <span className="account-gate__mark" aria-hidden="true"><ProductMark eager /></span>
        <p className="account-gate__eyebrow">Defense Budget & Spend Analytics</p>
        <h1 id="account-gate-title">{setup ? "Create the super-user account" : "Sign in"}</h1>
        <p>{setup ? "The first account created owns this workspace and can manage its profile and access." : "Use your workspace account to continue."}</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (mismatch) return;
          onSubmit({ email, displayName, title, password });
        }}>
          {setup ? <label>Display name<input required minLength={2} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label> : null}
          <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {setup ? <label>Title <span>(optional)</span><input autoComplete="organization-title" value={title} onChange={(event) => setTitle(event.target.value)} /></label> : null}
          <label>Password<input required minLength={12} type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {setup ? <label>Confirm password<input required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label> : null}
          {mismatch ? <p className="account-form__error" role="alert">Passwords do not match.</p> : null}
          {error ? <p className="account-form__error" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy || mismatch}><LockKeyhole size={17} />{busy ? "Working…" : setup ? "Create super-user account" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}

export default function AuthProvider({ children }) {
  const [status, setStatus] = useState({ loading: true, staticHost: false, enabled: false, required: false, claimed: false, user: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    authApi.status().then((next) => { if (active) setStatus({ loading: false, staticHost: false, ...next }); })
      .catch((requestError) => {
        if (!active) return;
        if (requestError.staticHost) setStatus({ loading: false, staticHost: true, enabled: false, required: false, claimed: false, user: null });
        else {
          setError(requestError.message);
          setStatus({ loading: false, staticHost: false, enabled: true, required: true, claimed: true, user: null });
        }
      });
    return () => { active = false; };
  }, []);

  const run = async (operation) => {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      setStatus((current) => ({ ...current, claimed: true, user: result.user || current.user }));
      return result;
    } catch (operationError) {
      setError(operationError.message);
      throw operationError;
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => ({
    ...status,
    busy,
    error,
    claim: (values) => run(() => authApi.claim(values)),
    login: (values) => run(() => authApi.login(values)),
    logout: async () => { await authApi.logout(); setStatus((current) => ({ ...current, user: null })); },
    updateProfile: async (values) => { const result = await authApi.updateProfile(values); setStatus((current) => ({ ...current, user: result.user })); return result; },
    changePassword: (values) => authApi.changePassword(values),
    listAgentKeys: () => authApi.listAgentKeys(),
    createAgentKey: (values) => authApi.createAgentKey(values),
    revokeAgentKey: (id) => authApi.revokeAgentKey(id),
    clearError: () => setError(""),
  }), [status, busy, error]);

  if (status.loading) return <main className="account-gate account-gate--loading" role="status"><span className="account-gate__mark" aria-hidden="true"><ProductMark eager /></span><h1>Loading workspace</h1></main>;
  if (status.enabled && status.required && !status.claimed) return <AccountGate mode="setup" busy={busy} error={error} onSubmit={(values) => void value.claim(values).catch(() => {})} />;
  if (status.enabled && status.required && !status.user) return <AccountGate mode="login" busy={busy} error={error} onSubmit={(values) => void value.login(values).catch(() => {})} />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
