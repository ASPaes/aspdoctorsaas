/**
 * Central function to determine which "bucket" a conversation belongs to.
 * Uses data from the v_whatsapp_conversations_state view.
 *
 * Priority order:
 *  1. closed → 'closed'
 *  2. attendance in_progress → 'in_progress'
 *  3. waiting + opened_out_of_hours → 'waiting_out_of_hours'
 *  4. waiting (normal) → 'waiting_in_hours'
 */

export type ConversationBucket =
  | "closed"
  | "in_progress"
  | "waiting_out_of_hours"
  | "waiting_in_hours";

export interface ConversationStateRow {
  conversation_id: string;
  conversation_status: string;
  attendance_status: string | null;
  opened_out_of_hours: boolean;
  attendance_assigned_to: string | null;
  department_id: string | null;
  tenant_id: string;
}

export function getConversationBucket(row: ConversationStateRow): ConversationBucket {
  // 1. Closed conversation or closed/inactive attendance
  if (
    row.conversation_status === "closed" ||
    row.attendance_status === "closed" ||
    row.attendance_status === "inactive_closed"
  ) {
    return "closed";
  }

  // 2. Active attendance in progress
  if (row.attendance_status === "in_progress") {
    return "in_progress";
  }

  // 3. Waiting + opened out of hours (not yet attended)
  if (row.opened_out_of_hours) {
    return "waiting_out_of_hours";
  }

  // 4. Default: waiting in hours (queue)
  return "waiting_in_hours";
}

/** Map a bucket to the pill key used in the UI */
export function bucketToPill(bucket: ConversationBucket): string {
  switch (bucket) {
    case "closed":
      return "closed";
    case "in_progress":
      return "in_progress";
    case "waiting_out_of_hours":
      return "after_hours";
    case "waiting_in_hours":
      return "waiting";
  }
}
