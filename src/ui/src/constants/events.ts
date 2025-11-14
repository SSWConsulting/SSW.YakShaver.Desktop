export const UNDO_EVENT_CHANNEL = "yakshaver:undo-event";

export type UndoEventDetail = {
  type: "start" | "complete" | "error" | "reset";
};

