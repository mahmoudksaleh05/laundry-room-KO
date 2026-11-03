import type { ErrorCode } from './errors';

export type MachineType = 'washer' | 'dryer';
export const MACHINE_TYPES: MachineType[] = ['washer', 'dryer'];

export type MachineState =
  | 'FREE'
  | 'RESERVED'
  | 'RUNNING'
  | 'FINISHED'
  | 'OCCUPIED_UNKNOWN'
  | 'OUT_OF_ORDER';

export interface PublicUser {
  id: number;
  name: string;
  emoji: string;
}

export interface MachineView {
  id: string;
  type: MachineType;
  label: string;
  state: MachineState;
  owner: PublicUser | null;
  reservedUntil: number | null;
  startedAt: number | null;
  endsAt: number | null;
  finishedAt: number | null;
  estMin: number | null;
  extUsed: number;
  snoozeUsed: boolean;
  note: string | null;
  /** user ids whose "clothes are out" / "it's empty now" confirmation is still valid */
  confirmedBy: number[];
  /** when other users may confirm a FINISHED machine (owner pinged + 5 min) */
  confirmUnlockAt: number | null;
}

export interface QueueEntry {
  userId: number;
  name: string;
  emoji: string;
  estMin: number;
  status: 'waiting' | 'reserved';
  missed: number;
  compensation: boolean;
  eligibleAt: number;
}

export interface Settings {
  windowMin: number;
  snoozeMin: number;
  capMin: number;
  quietStart: string;
  quietEnd: string;
  tz: string;
  linksAllowed: boolean;
  presets: Record<MachineType, number[]>;
}

export interface Snapshot {
  serverNow: number;
  machines: MachineView[];
  queues: Record<MachineType, QueueEntry[]>;
  blocks: { userId: number; type: MachineType; until: number }[];
  quiet: boolean;
  settings: Settings;
  demo: boolean;
}

export type MessageKind = 'normal' | 'announcement' | 'system';

export interface ChatMessage {
  id: number;
  kind: MessageKind;
  text: string;
  at: number;
  user: PublicUser | null;
  pinnedUntil: number | null;
  reports: number;
}

export interface Me {
  id: number;
  name: string;
  emoji: string;
  isAdmin: boolean;
  mutedUntil: number | null;
}

export interface Hello {
  me: Me;
  serverNow: number;
  vapidPublicKey: string;
}

export type Ack<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; code: ErrorCode; retryAfterMs?: number };
