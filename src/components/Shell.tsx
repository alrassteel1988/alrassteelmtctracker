import Link from "next/link";
import { COMPANIES, type AppUser, type Company } from "@/lib/auth";
import { signOut } from "@/app/actions";

type Active =
  | "overview" | "shipments" | "intake" | "review" | "library" | "erp" | "masters" | "audit"
  | "group" | "users" | "settings";

export function Shell({ user, co, active, children }: { user: AppUser; co?: Company; active: Active; children: React.ReactNode }) {
  const c = co ?? user.companies[0];
  const info = COMPANIES[c];
  const other = user.companies.find((x) => x !== c);
  const nav: [Active, string, string][] = [
    ["overview", "Overview", `/c/${c}`],
    ["shipments", "Purchase orders", `/c/${c}/shipments`],
    ["intake", "New MTC intake", `/c/${c}/intake`],
    ["review", "Review queue", `/c/${c}/shipments?status=review`],
    ["erp", "ERP exports", `/c/${c}/shipments?status=approved`],
    ["library", "Certificate library", `/c/${c}/library`],
    ["masters", "Master data", `/c/${c}/masters`],
    ["audit", "Audit history", `/c/${c}/audit`],
  ];
  return (
    <>
      <div className="strip">
        <span><b>{c}</b> {info.name}</span>
        <span>{info.location}</span>
        <span className="grow" />
        <span>Times shown in Dubai time (GST)</span>
      </div>
      <div className="app">
        <nav className="side">
          <div className="brand">
            <div className="logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="mark" src="/mark.svg" alt="" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="wm" src="/wordmark.png" alt="Al Ras Steel since 1988" />
            </div>
            <div className="prod"><b>MTC Tracker</b><span>Mill test certificates</span></div>
          </div>
          <div className="sec">{c} workspace</div>
          {nav.map(([k, label, href]) => (
            <Link key={k} href={href} className={active === k ? "on" : ""}>{label}</Link>
          ))}
          {user.role === "admin" && (
            <>
              <div className="sec">Group admin</div>
              <Link href="/group" className={active === "group" ? "on" : ""}>Group overview</Link>
              <Link href="/admin/users" className={active === "users" ? "on" : ""}>Users and access</Link>
              <Link href="/admin/settings" className={active === "settings" ? "on" : ""}>Settings and uploaders</Link>
            </>
          )}
          <div className="foot">Pilot build{process.env.VERCEL_GIT_COMMIT_SHA ? ` · ${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}` : ""}</div>
        </nav>
        <div>
          <div className="top">
            <span className="copill">
              {c} | {info.location.split(" | ")[0]}
              {other && <Link href={`/c/${other}`}>Switch to {other}</Link>}
            </span>
            <span className="grow" />
            <span className="who">{user.name}<span>{user.role === "admin" ? "Group Admin" : `Store · ${user.company}`}</span></span>
            <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
            <form action={signOut}><button className="btn">Sign out</button></form>
          </div>
          <main>{children}</main>
        </div>
      </div>
    </>
  );
}

const STATUS: Record<string, [string, string]> = {
  draft: ["Waiting for files", ""],
  reading: ["AI reading", "blue"],
  review: ["Ready to review", "amber"],
  blocked: ["Blocked", "red"],
  partial: ["Part approved", "blue"],
  approved: ["Excel ready", "complete"],
  erp_done: ["In ERP", "complete"],
};
export function StatusBadge({ s }: { s: string }) {
  const [t, c] = STATUS[s] ?? [s, ""];
  return <span className={`badge ${c}`}>{t}</span>;
}
export const STATUS_LABELS = STATUS;
