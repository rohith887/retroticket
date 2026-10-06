import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Section, Skeleton, toast } from "../../../ui";
import { formatDateTime } from "../../../ui/time";
import { useUser } from "../../../store/session";
import { SESSIONS_KEY, fetchSessions, revokeSession } from "./api";

/** "Chrome on Windows" from a raw user-agent string; falls back to the string itself. */
function describeAgent(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || ua || "Unknown device";
}

export default function SessionSettings() {
  const { fetchWithAuth } = useUser();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(null);

  const { data: sessions, isLoading, error } = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => fetchSessions(fetchWithAuth) });

  const revoke = useMutation({
    mutationFn: (id) => revokeSession(fetchWithAuth, id),
    onMutate: (id) => setPending(id),
    onSuccess: () => {
      toast.success("Session signed out");
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setPending(null),
  });

  const others = (sessions || []).filter((s) => !s.current);

  async function revokeOthers() {
    setPending("all");
    try {
      await Promise.all(others.map((s) => revokeSession(fetchWithAuth, s._id)));
      toast.success("Signed out of other sessions");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPending(null);
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    }
  }

  return (
    <Section
      title="Active sessions"
      description="Devices currently signed in to your account."
      actions={
        <Button variant="secondary" size="sm" onClick={revokeOthers} loading={pending === "all"} disabled={others.length === 0 || !!pending}>
          Sign out other sessions
        </Button>
      }
    >
      {error ? (
        <Alert tone="danger">{error.message}</Alert>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {sessions.map((s) => (
            <li key={s._id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-body-sm font-medium text-ink">
                  <span className="truncate">{describeAgent(s.userAgent)}</span>
                  {s.current && <Badge tone="success">This device</Badge>}
                </p>
                <p className="truncate text-caption text-ink-muted">
                  {s.ipAddress || "Unknown IP"} · Signed in {formatDateTime(s.createdAt)}
                </p>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s._id)} loading={pending === s._id} disabled={!!pending}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
