import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import selarWebhookRouter from './routes/selar.js';
import blueprintsRouter from './routes/blueprints.js';
import graphRouter from './routes/graph.js';
import configRouter from './routes/config.js';

const app = express();

// Selar's webhook needs the raw request body to verify its signature, so
// this is mounted with express.raw() BEFORE the global JSON parser below.
app.use('/api/webhooks/selar', express.raw({ type: '*/*' }), selarWebhookRouter);

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(',') : '*' }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/blueprints', blueprintsRouter);
app.use('/api/blueprints', graphRouter); // adds nested /:blueprintId/groups, /options/:id/freeze, etc.
app.use('/api/config', configRouter);

// Centralized error handler — every route's catch(next) lands here.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ThinkMaps API listening on port ${port}`));

// Self-ping keepalive at a sensible 10-minute interval (not aggressive) to
// help keep a Render free-tier instance warm. Leave SELF_PING_URL unset to
// disable this entirely.
if (process.env.SELF_PING_URL) {
  const TEN_MINUTES = 10 * 60 * 1000;
  setInterval(() => {
    fetch(process.env.SELF_PING_URL).catch(() => {});
  }, TEN_MINUTES);
}
