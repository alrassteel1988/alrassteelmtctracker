"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm({ error }: { error?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(
    error === "no-access" ? "This account is not on the access list. Ask an administrator." : null,
  );

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) return setMsg(error.message === "Invalid login credentials" ? "Email or password is wrong." : error.message);
    router.replace("/");
    router.refresh();
  }

  async function reset() {
    if (!email) return setMsg("Type your work email first, then click Forgot password.");
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/set-password`,
    });
    setMsg(error ? error.message : "If that email has access, a reset link is on its way.");
  }

  return (
    <form onSubmit={signIn}>
      <div style={{ display: "grid", gap: 4 }}>
        <span className="small mute">Authorised access only</span>
        <h2 style={{ fontSize: 28 }}>Welcome back</h2>
        <p className="mute">Sign in with your work account.</p>
      </div>
      {msg && <div className="note">{msg}</div>}
      <label className="f">Work email
        <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@alrassteel.com" />
      </label>
      <label className="f">
        <span className="row" style={{ justifyContent: "space-between" }}>
          Password
          <span className="row small">
            <button type="button" className="copy" onClick={reset}>Forgot password?</button>
            <button type="button" className="copy" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
          </span>
        </span>
        <input type={show ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button className="btn p" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="small mute">Need access? Contact your administrator: glory@alrassteel.com or chiraag@alrassteel.com.</p>
    </form>
  );
}
