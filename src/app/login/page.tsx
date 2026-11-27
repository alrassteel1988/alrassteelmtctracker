import { LoginForm } from "./LoginForm";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login">
      <div className="art">
        <div className="brand">
          <div className="logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark" src="/mark.svg" alt="" style={{ height: 64 }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="wm" src="/wordmark.png" alt="Al Ras Steel since 1988" style={{ height: 38 }} />
          </div>
        </div>
        <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
          <span style={{ color: "var(--amber)", fontWeight: 600 }}>Mill test certificate tracker</span>
          <h1 style={{ fontSize: 44 }}>Al Ras Steel MTC Tracker</h1>
          <p style={{ color: "#dbe5f3" }}>Turn each purchase order&apos;s mill certificates into a ready ERP Excel, and keep every MTC searchable.</p>
          <p style={{ color: "#8ea4c2", fontSize: 13 }}>ARST · Al Ras Steel Trading FZCO &nbsp; ARBM · Al Ras Building Material</p>
        </div>
      </div>
      <LoginForm error={error} />
    </div>
  );
}
