"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function SetPassword() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setMsg("Use at least 10 characters.");
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    if (error) return setMsg(error.message);
    router.replace("/");
  }
  return (
    <div className="login" style={{ gridTemplateColumns: "1fr" }}>
      <form onSubmit={save}>
        <h2>Set your password</h2>
        {msg && <div className="note">{msg}</div>}
        <label className="f">New password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <button className="btn p">Save and continue</button>
      </form>
    </div>
  );
}
