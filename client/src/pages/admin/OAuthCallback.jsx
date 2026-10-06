// Shared "finishing Gmail authorisation" screen for the SMTP and Email Queue OAuth redirects.
// Each route passes the same API call it always made; only the presentation changed.
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, BackLink, Button, Page, Spinner, toast } from "../../ui";
import { useUser } from "../../store/session";

export default function OAuthCallback({ buildRequest, returnTo, returnLabel }) {
  const { fetchWithAuth } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false); // the effect must run once even under React strict mode

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const params = new URLSearchParams(location.search);
      const request = buildRequest(params);
      if (!request) {
        setError("The authorisation response is missing required parameters.");
        return;
      }
      try {
        const response = await fetchWithAuth(request, { method: "GET" });
        if (!response.ok) throw new Error(`Authorisation failed (${response.status})`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || data.message || "Authorisation failed");
        toast.success("Gmail authorisation completed");
        navigate(returnTo, { replace: true });
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page variant="form">
      <BackLink to={returnTo}>{returnLabel}</BackLink>
      {error ? (
        <div className="space-y-3">
          <Alert tone="danger" title="We couldn't complete the authorisation">
            {error}
          </Alert>
          <Button onClick={() => navigate(returnTo)}>Back to {returnLabel}</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 py-10 text-body-sm text-ink-muted" role="status">
          <Spinner label="Completing authorisation" />
          Completing Gmail authorisation…
        </div>
      )}
    </Page>
  );
}
