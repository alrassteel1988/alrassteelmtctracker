"use client";
import { useActionState } from "react";
import { createDevice } from "../actions";

export function DeviceForm() {
  const [state, action, pending] = useActionState(createDevice, {});
  return (
    <form action={action} className="card soft">
      <h3>Add a store PC uploader</h3>
      <div className="grid4">
        <label className="f">Company<select name="company_code"><option>ARBM</option><option>ARST</option></select></label>
        <label className="f">PC name<input name="name" placeholder="ARBM-STORE-01" required /></label>
        <label className="f">MTC inbox folder<input name="inbox_folder" placeholder="D:\MTC Inbox\ARBM" /></label>
        <label className="f">Excel folder<input name="excel_folder" placeholder="D:\MTC Excel\ARBM" /></label>
      </div>
      <div><button className="btn p" disabled={pending}>Create uploader key</button></div>
      {state.error && <div className="note err">{state.error}</div>}
      {state.token && (
        <div className="note">
          <b>Uploader key for {state.name}: shown only once</b>
          <div className="mono" style={{ wordBreak: "break-all", margin: "6px 0" }}>{state.token}</div>
          Run the installer on that PC and paste this key when it asks. If it is lost, disable this PC and create a new key.
        </div>
      )}
    </form>
  );
}
