export const ERROR_TEXT = {
  NOT_YOUR_TURN: "It's not your turn for this machine yet.",
  ALREADY_CLAIMED: 'Someone beat you to it, by a second.',
  ALREADY_IN_QUEUE: 'You already have a spot for this machine type.',
  QUEUE_BLOCKED: "You missed two turns in a row, so you can't join this line for a little while.",
  RATE_LIMITED: 'Easy there. Try again in a moment.',
  INVALID_STATE: "That can't be done right now. The machine may have just changed.",
  INVALID_INPUT: "Something in that didn't look right.",
  NAME_TAKEN: 'Someone in that room already uses this name. Log in instead, or pick another name.',
  ROOM_FULL: 'This room already has 2 people signed up.',
  NO_ACCOUNT: 'No account with that name in this room yet.',
  BAD_CODE: "That code didn't work.",
  MUTED: 'You are muted for now.',
  LINKS_BLOCKED: 'Links are not allowed on the board.',
  NOT_ADMIN: 'Only admins can do that.',
  LOCKED_OUT: 'Too many wrong tries. Wait 15 minutes.',
  CAP_REACHED: 'This cycle is already as long as it can be.',
  DUPLICATE_CONFIRMATION: 'You already confirmed this one. Someone else needs to confirm too.',
  TOO_EARLY: 'Give the owner a few more minutes first.',
  NOT_FOUND: "That doesn't exist anymore.",
  AUTH: 'Please sign in again.',
  OFFLINE: "You're offline. Reconnecting…",
  INTERNAL: 'Something went wrong on our side. Please try again.',
} as const;

export type ErrorCode = keyof typeof ERROR_TEXT;

export const errorText = (code: string) =>
  (ERROR_TEXT as Record<string, string>)[code] ?? 'Something went wrong. Please try again.';
