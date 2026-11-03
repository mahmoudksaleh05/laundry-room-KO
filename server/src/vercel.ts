import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app';

// Vercel function: one Fastify app per warm instance.
const app = buildApp();
const ready = app.ready();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  app.server.emit('request', req, res);
}
