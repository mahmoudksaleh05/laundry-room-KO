import { z } from 'zod';

const type = z.enum(['washer', 'dryer']);
const machineId = z.string().min(1).max(32);
const estMin = z.number().int().min(15).max(180);
const m = z.object({ machineId });

export const name = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[\p{L}\p{N} ._'-]+$/u, 'letters, numbers, spaces');
export const emoji = z.string().min(1).max(16);
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Every command a resident can send over the socket. */
export const userCommands = {
  join: z.object({ type, estMin }),
  leave: z.object({ type }),
  startNow: z.object({ machineId, estMin }),
  loaded: m,
  snooze: m,
  giveUp: m,
  notEmpty: m,
  extend: z.object({ machineId, minutes: z.union([z.literal(5), z.literal(10)]) }),
  finishEarly: m,
  collect: m,
  confirmOut: m,
  markOccupied: m,
  confirmClear: m,
  reportBroken: z.object({ machineId, note: z.string().trim().max(120).default('') }),
  markFixed: m,
  sendMessage: z.object({ text: z.string().trim().min(1).max(280), announce: z.boolean().default(false) }),
  reportMessage: z.object({ messageId: z.number().int() }),
};

/** Admin-only commands (device must be in admin mode). */
export const adminCommands = {
  forceFree: m,
  removeFromQueue: z.object({ userId: z.number().int(), type }),
  deleteMessage: z.object({ messageId: z.number().int() }),
  unpin: z.object({ messageId: z.number().int() }),
  mute: z.object({ userId: z.number().int(), minutes: z.number().int().min(0).max(60 * 24 * 30) }),
  rotateCode: z.object({ code: z.string().trim().min(4).max(32) }),
  setSettings: z.object({
    quietStart: hhmm,
    quietEnd: hhmm,
    tz: z.string().min(1).max(64),
    linksAllowed: z.boolean(),
    windowMin: z.number().int().min(3).max(30),
  }),
  addMachine: z.object({ type, label: z.string().trim().min(1).max(24) }),
  renameMachine: z.object({ machineId, label: z.string().trim().min(1).max(24) }),
  moveMachine: z.object({ machineId, dir: z.union([z.literal(-1), z.literal(1)]) }),
  retireMachine: m,
  restoreMachine: m,
  listUsers: z.object({}),
  listRetired: z.object({}),
  auditLog: z.object({ before: z.number().int().optional(), limit: z.number().int().min(1).max(200).default(100) }),
  demoForward: z.object({ minutes: z.number().int().min(1).max(600) }),
  exitAdmin: z.object({}),
};

export type UserCommand = keyof typeof userCommands;
export type AdminCommand = keyof typeof adminCommands;
export type CommandName = UserCommand | AdminCommand;
export type CommandInput<K extends CommandName> = K extends UserCommand
  ? z.input<(typeof userCommands)[K]>
  : K extends AdminCommand
    ? z.input<(typeof adminCommands)[K]>
    : never;

export const registerBody = z.object({ code: z.string().trim().min(1).max(32), name, emoji });
export const recoverBody = z.object({
  code: z.string().trim().min(1).max(32),
  name,
  recoveryCode: z.string().trim().min(8).max(12),
});
