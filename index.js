javascriptconst express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'cventas2024';

app.get('/', (req, res) => res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="facebook-domain-verification" content="opoc76nzl70bblpisnlvr50gwqsaav" />
<title>CVENTAS Bot</title>
</head>
<body>CVENTAS Bot activo</body>
</html>`));

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CVENTAS Bot corriendo en puerto ${PORT}`));
