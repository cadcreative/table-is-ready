// SMS sender interface: every provider exposes
//   name: string, demo: boolean, send({ to, body }) -> Promise<{ id, status }>
// Add a new provider by writing a factory below and selecting it in createSender().

function createDemoSender() {
  return {
    name: 'demo',
    demo: true,
    async send({ to, body }) {
      console.log(`[DEMO SMS] would send to ${to}: ${body}`);
      return { id: 'demo-' + Date.now(), status: 'demo' };
    },
  };
}

function createTwilioSender({ accountSid, authToken, from }) {
  const twilio = require('twilio');
  const client = twilio(accountSid, authToken);
  return {
    name: 'twilio',
    demo: false,
    async send({ to, body }) {
      const msg = await client.messages.create({ to, from, body });
      return { id: msg.sid, status: msg.status };
    },
  };
}

function createSender(env = process.env) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = env;
  if ((env.SMS_PROVIDER || '').toLowerCase() === 'demo') return createDemoSender();
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
    return createTwilioSender({
      accountSid: TWILIO_ACCOUNT_SID,
      authToken: TWILIO_AUTH_TOKEN,
      from: TWILIO_FROM_NUMBER,
    });
  }
  return createDemoSender();
}

module.exports = { createSender, createDemoSender, createTwilioSender };
