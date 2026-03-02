import { useEffect } from "react";

/**
 * Minimal OAuth callback page for Google Drive.
 * Extracts the auth code from the URL, sends it to the opener window
 * via postMessage, then closes itself.
 */
export function GoogleDriveCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (window.opener) {
      if (code) {
        window.opener.postMessage(
          { type: "google-drive-callback", code },
          window.location.origin
        );
      } else {
        window.opener.postMessage(
          { type: "google-drive-callback", error: error || "No authorization code received" },
          window.location.origin
        );
      }
      window.close();
    }
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-center space-y-2">
        <div className="text-sm text-muted-foreground">Connecting to Google Drive...</div>
        <div className="text-xs text-muted-foreground/60">This window will close automatically.</div>
      </div>
    </div>
  );
}
