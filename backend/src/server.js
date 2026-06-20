import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'thinkmaps-backend' });
});

// Feature routes get mounted here as each piece is built:
// app.use('/api/blueprints', blueprintsRouter);
// app.use('/api/graph', graphRouter);       // Mistral - node/group generation
// app.use('/api/ideas', ideasRouter);       // Gemini - research + idea generation
// app.use('/api/validation', validationRouter);
// app.use('/api/selar', selarWebhookRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`thinkmaps-backend listening on port ${PORT}`);
});
