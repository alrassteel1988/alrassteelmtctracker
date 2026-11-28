"use client";
import { useState, useTransition } from "react";
import { invite } from "../actions";

export function InviteButton({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="row">
      <button className="btn sm" disabled={pending} onClick={() => start(async () => setMsg((await invite(email)).message))}>{pending ? "Sending…" : "Invite / resend"}</button>
      {msg && <span className="small mute">{msg}</span>}
    </span>
  );
}
