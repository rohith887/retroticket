import React from "react";
import ThreadsWorkspace from "../../components/threads/ThreadsWorkspace";

/** Moderator "Applications": the shared threads workspace, scoped by the API to the moderator's cases. */
export default function PortalThreads() {
  return <ThreadsWorkspace basePath="/portal" />;
}
