const express = require('express');
const fs = require('fs');
const https = require('https');
const app = express();
app.use(express.json());
app.use(express.static('.'));

const VERIFY_TOKEN = 'cventas2024';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = '1257920514073124';

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

function armarRespuesta() {
    const producto = JSON.parse(fs.readFileSync('./producto.json', 'utf8'));

  let texto = `¡Hola! Gracias por escribirnos a *C-Ventas* 📲\n\n`;
    texto += `*${producto.nombre}*\n\n`;
    texto += `Características:\n`;
    producto.caracteristicas.forEach(function(c) {
          texto += `• ${c}\n`;
    });
    texto += `\n💰 Precio contado: ${producto.precio_contado}\n\n`;
    texto += `💳 Financiación:\n`;
    producto.financiacion.forEach(function(f) {
          texto += `• ${f}\n`;
    });
    texto += `\nSeguinos para más ofertas:\n`;
    texto += `📷 Instagram: ${producto.instagram}\n`;
    texto += `👍 Facebook: ${producto.facebook}\n`;
    texto += `\n¿Te interesa? Contanos y coordinamos la compra.`;

  return texto;
}

function enviarMensaje(numeroDestino, texto) {
    const data = JSON.stringify({
          messaging_product: 'whatsapp',
          to: numeroDestino,
          type: 'text',
          text: { body: texto }
    });

  const options = {
        hostname: 'graph.facebook.com',
        path: '/v21.0/' + PHONE_NUMBER_ID + '/messages',
        method: 'POST',
        headers: {
                'Authorization': 'Bearer ' + WHATSAPP_TOKEN,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
        }
  };

  const req = https.request(options, function(res) {
        let body = '';
        res.on('data', function(chunk) { body += chunk; });
        res.on('end', function() { console.log('Respuesta de Meta:', body); });
  });

  req.on('error', function(e) { console.error('Error enviando mensaje:', e); });
    req.write(data);
    req.end();
}

app.post('/webhook', function(req, res) {
    var body = req.body;

           if (body.object === 'whatsapp_business_account') {
                 try {
                         const entry = body.entry && body.entry[0];
                         const changes = entry && entry.changes && entry.changes[0];
                         const value = changes && changes.value;
                         const mensajes = value && value.messages;

                   if (mensajes && mensajes.length > 0) {
                             const mensaje = mensajes[0];
                             const numeroCliente = mensaje.from;

                           const respuesta = armarRespuesta();
                             enviarMensaje(numeroCliente, respuesta);
                   }
                 } catch (e) {
                         console.error('Error procesando mensaje entrante:', e);
                 }

      res.sendStatus(200);
           } else {
                 res.sendStatus(404);
           }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log('CVENTAS Bot corriendo en puerto ' + PORT);
});
