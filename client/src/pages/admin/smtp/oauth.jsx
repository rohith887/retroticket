import React from "react";
import OAuthCallback from "../OAuthCallback";

// Same request as before: GET /v1/config/authentication/email/oauth/gmail?code=…
export default function SmtpOAuth() {
  return (
    <OAuthCallback
      returnTo="/admin/smtp"
      returnLabel="SMTP"
      buildRequest={(params) => {
        const code = params.get("code");
        return code ? `/v1/config/authentication/email/oauth/gmail?code=${encodeURIComponent(code)}` : null;
      }}
    />
  );
}
