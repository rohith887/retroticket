import React from "react";
import OAuthCallback from "../OAuthCallback";

// Same request as before: GET /v1/email-queue/oauth/gmail?code=…&mailboxId=… (mailbox id arrives as the OAuth "state").
export default function EmailQueueOAuth() {
  return (
    <OAuthCallback
      returnTo="/admin/email-queues"
      returnLabel="Email queues"
      buildRequest={(params) => {
        const code = params.get("code");
        const mailboxId = params.get("state");
        return code && mailboxId ? `/v1/email-queue/oauth/gmail?code=${encodeURIComponent(code)}&mailboxId=${encodeURIComponent(mailboxId)}` : null;
      }}
    />
  );
}
