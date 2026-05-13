const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'cventas2024';

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive messages
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const messages = change.value?.messages;
        if (messages) {
          messages.forEach(msg => {
            const from = msg.from;
            const text = msg.text?.body?.toLowerCase() || '';
            console.log(`Mensaje de ${from}: ${text}`);
            // Detectar pagos
            if (text.includes('transfer') || text.includes('pag') || text.includes('deposit') || /\$\s?[\d.,]+/.test(text)) {
              console.log(`PAGO DETECTADO de ${from}: ${msg.text?.body}`);
            }
          });
        }
      });
    });
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.get('/', (req, res) => res.send('CVENTAS Bot activo ✓'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CVENTAS Bot corriendo en puerto ${PORT}`));
