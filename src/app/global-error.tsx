"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = /Server Action|deployment|ChunkLoadError|Loading chunk/i.test(error.message);
  return (
    <html lang="en"><body>
    <div style={{ maxWidth: 560, margin: "15vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h2>Something went wrong on this page</h2>
      <p>
        {stale
          ? "The app was updated while this page was open. Reload to get the new version."
          : "Reload the page and try again. If it keeps happening, send a screenshot of this message."}
      </p>
      <p style={{ color: "#667", fontSize: 13 }}>{error.message}{error.digest ? ` (ref ${error.digest})` : ""}</p>
      <button onClick={() => (stale ? window.location.reload() : reset())} style={{ padding: "8px 16px" }}>Reload</button>
    </div>
    </body></html>
  );
}
