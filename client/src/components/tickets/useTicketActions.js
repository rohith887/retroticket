// Ticket mutations for the workspace. Each one patches the cached ticket + inbox lists immediately (so the UI and the
// row update at once), rolls back if the request fails, and refetches the lists / counters when it settles.
import { createElement, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "../../store/session";
import { toast } from "../../ui";
import { TICKET_LISTS_KEY, applyTicketUpdate, assignTicket, postComment, retryComment, setTicketComplete, ticketKey, undoComment, updateTicketFields } from "./model";

export function useTicketActions(ticketId) {
  const { fetchWithAuth, user } = useUser();
  const queryClient = useQueryClient();

  const settle = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: TICKET_LISTS_KEY });
    queryClient.invalidateQueries({ queryKey: ["adminSummary"] });
  }, [queryClient]);

  /** Optimistic patch with rollback. `request` performs the API call; `patch` is what the UI shows meanwhile. */
  const mutate = useCallback(
    async (patch, request, success) => {
      const previous = queryClient.getQueryData(ticketKey(ticketId));
      const rollback = previous ? Object.fromEntries(Object.keys(patch).map((k) => [k, previous[k]])) : null;
      applyTicketUpdate(queryClient, ticketId, patch);
      try {
        const result = await request();
        if (success) toast.success(success);
        return result;
      } catch (error) {
        if (rollback) applyTicketUpdate(queryClient, ticketId, rollback);
        toast.error(error.message);
        throw error;
      } finally {
        settle();
      }
    },
    [queryClient, ticketId, settle]
  );

  return {
    setPriority: (priority) => mutate({ priority }, () => updateTicketFields(fetchWithAuth, ticketId, { priority }), "Priority updated"),
    setStatus: (status) => mutate({ status }, () => updateTicketFields(fetchWithAuth, ticketId, { status }), "Status updated"),
    setComplete: (complete) => mutate({ isComplete: complete }, () => setTicketComplete(fetchWithAuth, ticketId, complete), complete ? "Ticket resolved" : "Ticket reopened"),
    /** `person` = { _id, name } or null to unassign. */
    assign: async (person) => {
      const result = await mutate(
        { assignedTo: person ? { _id: person._id, name: person.name } : null },
        () => assignTicket(fetchWithAuth, ticketId, person?._id || null),
        person ? (person._id === user?._id ? "Assigned to you" : `Assigned to ${person.name}`) : "Ticket unassigned"
      );
      // The server returns the populated assignee; use it so the name is authoritative.
      if (result?.assignedTo !== undefined) applyTicketUpdate(queryClient, ticketId, { assignedTo: result.assignedTo });
      return result;
    },
    comment: async (text, isPublic) => {
      const refresh = () => queryClient.invalidateQueries({ queryKey: ticketKey(ticketId) });
      let result;
      try {
        // One id per send attempt: a network retry cannot create the message twice.
        result = await postComment(fetchWithAuth, ticketId, text, isPublic, crypto.randomUUID());
      } catch (error) {
        toast.error(error.message);
        throw error;
      }
      await refresh();
      if (!isPublic) {
        toast.success("Internal note added");
      } else if (result.emailed) {
        // The email waits out a short undo window; the toast offers Undo for exactly that long.
        const windowMs = Math.max(0, new Date(result.sendAfter).getTime() - Date.now());
        const undo = async (closeToast) => {
          try {
            await undoComment(fetchWithAuth, result.comment._id);
            toast.info("Reply not sent");
          } catch (error) {
            toast.error(error.message);
          }
          closeToast?.();
          refresh();
        };
        toast.success(
          ({ closeToast }) =>
            createElement(
              "span",
              { className: "flex items-center justify-between gap-3" },
              "Reply queued",
              windowMs > 0 ? createElement("button", { type: "button", className: "font-semibold underline", onClick: () => undo(closeToast) }, "Undo") : null
            ),
          { autoClose: Math.max(windowMs, 2500) }
        );
      } else {
        toast.warning(result.emailNote ? `Reply saved. ${result.emailNote}` : "Reply saved, but no email was sent.");
      }
      return result;
    },
    retry: async (commentId) => {
      try {
        await retryComment(fetchWithAuth, commentId);
        toast.success("Retrying");
      } catch (error) {
        toast.error(error.message);
      }
      queryClient.invalidateQueries({ queryKey: ticketKey(ticketId) });
    },
  };
}
