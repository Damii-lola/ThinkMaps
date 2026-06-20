import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../lib/supabaseClient.js';

const router = Router();

// ⚠️ FLAGGED ASSUMPTION: I don't have access to Selar's exact webhook payload
// shape or signature-header name from your dashboard — I couldn't confirm it
// from public docs either. The shape below follows the common pattern most
// checkout/subscription platforms use (event/type, data.email, data.status).
// Fire one real test event from your Selar dashboard, check the logged
// payload below, and tell me what it actually looks like — I'll adjust the
// field names in one pass.

function verifySignature(rawBody, signatureHeader) {
  if (!process.env.SELAR_WEBHOOK_SECRET) return true; // no secret set yet, skip check
  if (!signatureHeader) return false;

  const expected = crypto
    .createHmac('sha256', process.env.SELAR_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return expected === signatureHeader;
}

router.post('/', async (req, res) => {
  const rawBody = req.body; // Buffer — server.js mounts this route with express.raw()
  const signatureHeader = req.headers['x-selar-signature'] || req.headers['selar-signature'];

  if (!verifySignature(rawBody, signatureHeader)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Keep this log until the real field names are confirmed against a live
  // test event, then it's safe to remove or downgrade to debug-only.
  console.log('Selar webhook received:', JSON.stringify(payload));

  const eventType = (payload.event || payload.type || '').toLowerCase();
  const buyerEmail = payload.data?.email || payload.data?.buyer_email || payload.email;
  const status = (payload.data?.status || payload.status || '').toLowerCase();

  if (!buyerEmail) {
    return res.status(200).json({ received: true, note: 'No buyer email found in payload' });
  }

  const { data: profile } = await supabase.from('profiles').select('id').eq('email', buyerEmail).single();

  if (!profile) {
    console.warn(`Selar webhook: no matching ThinkMaps profile for ${buyerEmail}`);
    return res.status(200).json({ received: true, note: 'No matching user' });
  }

  const isCancelEvent = eventType.includes('cancel') || status === 'cancelled' || status === 'expired';
  const isActiveEvent =
    !isCancelEvent &&
    (eventType.includes('sale') ||
      eventType.includes('subscription') ||
      status === 'active' ||
      status === 'success');

  if (isCancelEvent) {
    await supabase.from('profiles').update({ plan: 'free', plan_expires_at: null }).eq('id', profile.id);
  } else if (isActiveEvent) {
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30); // 30-day pass, renewed by Selar's next charge event
    await supabase
      .from('profiles')
      .update({ plan: 'pro', plan_expires_at: periodEnd.toISOString() })
      .eq('id', profile.id);
  }

  await supabase.from('subscriptions').insert({
    user_id: profile.id,
    provider: 'selar',
    external_event: eventType || 'unknown',
    raw_payload: payload,
  });

  res.status(200).json({ received: true });
});

export default router;
