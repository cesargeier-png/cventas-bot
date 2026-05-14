const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('.'));

const VERIFY_TOKEN = 'cventas2024';

app.get('/robots.txt', function(req, res) {
  res.type('text/plain');
  res.send('User-agent: facebookexternalhit\nAllow: /\n\nUser-agent: *\nAllow: /');
});

app.get('/', function(req, res) {
  res.send('<!DOCTYPE html><html><head><meta name="facebook-domain-verification" content="opoc76nzl70bblpisnlvr50gwqsaav" /><title>CVENTAS Bot</title></head><body>CVENTAS Bot activo</body></html>');
});

app.get('/webhook', function(req, res) {
  var mode = req.query['hub.mode'];
  var token = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', function(req, res) {
  var body = req.body;
  if (body.object === 'whatsapp_business_account') {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('CVENTAS Bot corriendo en puerto ' + PORT);
});
