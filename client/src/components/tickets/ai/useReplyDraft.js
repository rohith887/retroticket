// State for the "Draft reply" action next to the composer. React -> Node only (/v1/ai/tickets/:id/reply-draft).
//
// Rules this hook enforces:
//   * A draft is only ever INSERTED INTO THE COMPOSER as normal editable text. Nothing here sends a message; the agent sends
//     with the composer's own button.
//   * The agent's own text is never overwritten silently: if the composer already has text, the draft waits for a choice.
//   * When the conversation changes (`version`), the server says whether the stored draft is stale; a stale draft is shown as out of date.
//   * Feedback (used as is, used after editing, dismissed) is recorded through Node for later review. Nothing is trained.
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "../../../store/session";
import { aiReplyDraftKey, aiStatusKey, fetchAiStatus, fetchReplyDraft, generateReplyDraft, sendDraftFeedback } from "./api";

export function useReplyDraft({ ticketId, version, composerText, insertIntoComposer }) {
  const { fetchWithAuth } = useUser();
  const queryClient = useQueryClient();
  const key = aiReplyDraftKey(ticketId);
  const [outcome, setOutcome] = useState(null); // { kind: "insufficient", reason } | { kind: "failed", reason }
  const [waitingToReplace, setWaitingToReplace] = useState(false);
  const inserted = useRef(null); // { id, text } of the draft currently placed in the composer
  const [insertedId, setInsertedId] = useState(null);

  const status = useQuery({ queryKey: aiStatusKey, queryFn: () => fetchAiStatus(fetchWithAuth), staleTime: 60_000, retry: false });
  const enabled = status.data?.enabled === true;
  // Re-read when the conversation changes so a draft made for an older message shows up as out of date.
  const stored = useQuery({ queryKey: [...key, version], queryFn: () => fetchReplyDraft(fetchWithAuth, ticketId), enabled, retry: false });
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    if (stored.data !== undefined) setCurrent(stored.data);
  }, [stored.data]);

  const place = useCallback(
    (draft) => {
      insertIntoComposer(draft.text);
      inserted.current = { id: draft._id, text: draft.text };
      setInsertedId(draft._id);
      setWaitingToReplace(false);
    },
    [insertIntoComposer]
  );

  const generate = useMutation({
    mutationFn: () => generateReplyDraft(fetchWithAuth, ticketId),
    onMutate: () => setOutcome(null),
    onSuccess: (result) => {
      if (result.ok && result.status === "ready") {
        setCurrent(result.insight);
        queryClient.invalidateQueries({ queryKey: key });
        if (!composerText.trim()) place(result.insight);
        else setWaitingToReplace(true);
      } else if (result.ok) {
        setCurrent(null);
        setOutcome({ kind: "insufficient", reason: result.reason });
      } else {
        setOutcome({ kind: "failed", reason: result.reason });
      }
    },
    onError: () => setOutcome({ kind: "failed", reason: "request_failed" }),
  });

  const feedback = useCallback(
    (insightId, event) => {
      // Recording feedback must never get in the agent's way: failures are ignored.
      sendDraftFeedback(fetchWithAuth, insightId, event).catch(() => {});
    },
    [fetchWithAuth]
  );

  /** Discard the draft: record the dismissal and, if the composer still holds the untouched draft, clear it. */
  const dismiss = useCallback(() => {
    if (!current) return;
    feedback(current._id, "dismissed");
    if (inserted.current && composerText.trim() === inserted.current.text.trim()) insertIntoComposer("");
    inserted.current = null;
    setInsertedId(null);
    setWaitingToReplace(false);
    setCurrent(null);
    queryClient.invalidateQueries({ queryKey: key });
  }, [current, feedback, composerText, insertIntoComposer, queryClient, key]);

  /** Call after the agent SENT a reply from the composer. Records whether the inserted draft was used as is or edited. */
  const onSent = useCallback(
    (body) => {
      const placed = inserted.current;
      if (!placed) return;
      feedback(placed.id, String(body).trim() === placed.text.trim() ? "used_unchanged" : "used_edited");
      inserted.current = null;
      setInsertedId(null);
      setCurrent(null);
      setWaitingToReplace(false);
      queryClient.invalidateQueries({ queryKey: key });
    },
    [feedback, queryClient, key]
  );

  return {
    enabled,
    draft: current,
    stale: Boolean(current?.stale),
    isGenerating: generate.isPending,
    outcome,
    waitingToReplace,
    generate: () => generate.mutate(),
    replaceWithDraft: () => current && place(current),
    keepMyText: () => setWaitingToReplace(false),
    dismiss,
    onSent,
    isInserted: Boolean(current && insertedId === current._id),
  };
}
