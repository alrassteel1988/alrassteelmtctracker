import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { saveUser, setActive } from "../actions";
import { InviteButton } from "./InviteButton";

export default async function Users() {
  const user = await requireAdmin();
  const db = await supabaseServer();
  const { data } = await db.from("app_users").select("*").order("role").order("email");
  return (
    <Shell user={user} active="users">
      <div className="head"><div><h1>Users and access</h1><p className="mute">Admins see both companies. Store users see only their own company. Use Invite to send a sign-in link; nobody shares passwords.</p></div></div>
      <div className="scroll">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((u) => (
              <tr key={u.email}>
                <td>{u.full_name}</td><td className="mono">{u.email}</td><td>{u.role === "admin" ? "Admin" : "Store"}</td><td>{u.company_code ?? "ARST + ARBM"}</td>
                <td><span className={`badge ${u.active ? "green" : ""}`}>{u.active ? "Active" : "Disabled"}</span></td>
                <td className="row">
                  <InviteButton email={u.email} />
                  {u.email !== user.email && <form action={setActive.bind(null, u.email, !u.active)}><button className="btn sm">{u.active ? "Disable" : "Enable"}</button></form>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={saveUser} className="card">
        <h2>Add or change a user</h2>
        <div className="grid4">
          <label className="f">Name<input name="full_name" required /></label>
          <label className="f">Work email<input name="email" type="email" required /></label>
          <label className="f">Role<select name="role"><option value="store">Store</option><option value="admin">Admin</option></select></label>
          <label className="f">Company (store users)<select name="company_code"><option value="">—</option><option>ARST</option><option>ARBM</option></select></label>
        </div>
        <div><button className="btn p">Save user</button></div>
      </form>
    </Shell>
  );
}
