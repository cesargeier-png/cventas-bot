const express = require('express');
const https = require('https');
const { initializeApp } = require('firebase/app');
const {
    getFirestore, collection, addDoc, doc, getDoc, setDoc, deleteDoc,
    query, where, orderBy, getDocs, serverTimestamp
} = require('firebase/firestore');
const app = express();
app.use(express.json());
app.use(express.static('.'));

const VERIFY_TOKEN = 'cventas2024';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = '1257920514073124';

const INSTAGRAM_LINK = 'https://instagram.com/c_ventasoficial';
const FACEBOOK_LINK = 'https://www.facebook.com/profile.php?id=61579064025433';
const NUMERO_CIERRE_VENTA = '543624856124';

const firebaseConfig = {
    apiKey: "AIzaSyDWqn3olCsE83ZvMg_PLWRAGHmCuGMOi0M",
    authDomain: "c-ventas.firebaseapp.com",
    projectId: "c-ventas",
    storageBucket: "c-ventas.firebasestorage.app",
    messagingSenderId: "281256606825",
    appId: "1:281256606825:web:7dcd9c861a67d6682f36f8"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

async function registrarInteresado(numeroCliente, textoRecibido, nombreProducto) {
    try {
        await addDoc(collection(db, 'bot_interesados'), {
            numero: numeroCliente,
            mensaje_recibido: textoRecibido || '',
            producto: nombreProducto,
            fecha: serverTimestamp(),
            atendido: false
        });
    } catch (e) {
        console.error('Error registrando interesado en Firestore:', e);
    }
}

async function obtenerCatalogoActivo() {
    try {
        const q = query(collection(db, 'catalogo_bot'), where('activo', '==', true), orderBy('orden', 'asc'));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Error leyendo catalogo_bot de Firestore:', e);
        return [];
    }
}

function armarFicha(producto) {
    const linkCompra = `https://wa.me/${NUMERO_CIERRE_VENTA}?text=${encodeURIComponent('Hola, me interesa ' + producto.nombre)}`;

let texto = `*${producto.nombre}*\n\n`;
    texto += `Características:\n`;
    (producto.caracteristicas || []).forEach(function(c) {
        texto += `• ${c}\n`;
    });
    texto += `\n✨💰 *Precio contado: ${producto.precio_contado}* 💰✨\n\n`;
    texto += `💳 Financiación:\n`;
    (producto.financiacion || []).forEach(function(f) {
        texto += `• ${f}\n`;
    });
    texto += `\n✅ Si estás interesado, hacé click y en breve te contactamos: ${linkCompra}\n`;
    texto += `\n🔙 Escribí "volver" para ver otras opciones`;
    return texto;
}

function armarNovedades() {
    let texto = `Seguinos en nuestras redes y enterate primero de nuestras ofertas 👇\n\n`;
    texto += `📸 Instagram: ${INSTAGRAM_LINK}\n`;
    texto += `📘 Facebook: ${FACEBOOK_LINK}\n`;
    texto += `\n🔙 Escribí "volver" para ver los productos`;
    return texto;
}

function armarMenu(productos) {
    let texto = `¡Hola! 👋 Bienvenido a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\n`;
    texto += `Estos son los productos disponibles esta semana:\n\n`;
    productos.forEach(function(p, i) {
        texto += `${i + 1}) ${p.nombre}\n`;
    });
    texto += `${productos.length + 1}) 📢 Novedades — seguinos en nuestras redes\n`;
    texto += `\nRespondé con el número del que te interesa y te paso todos los detalles.`;
    return texto;
}

function armarSinCatalogo() {
    return `¡Hola! 👋 Gracias por escribirnos a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\nEn este momento estamos actualizando el catálogo — escribinos en un rato y ya vas a poder ver las opciones disponibles. ¡Gracias por tu paciencia! 🙌`;
}

async function guardarEstadoMenu(numeroCliente, productos) {
    try {
        await setDoc(doc(db, 'bot_estado_conversacion', numeroCliente), {
            menu_ids: productos.map(p => p.id),
            fecha: serverTimestamp()
        });
    } catch (e) {
        console.error('Error guardando estado de conversación:', e);
    }
}

async function leerEstadoMenu(numeroCliente) {
    try {
        const snap = await getDoc(doc(db, 'bot_estado_conversacion', numeroCliente));
        return snap.exists() ? snap.data() : null;
    } catch (e) {
        console.error('Error leyendo estado de conversación:', e);
        return null;
    }
}

async function borrarEstadoMenu(numeroCliente) {
    try {
        await deleteDoc(doc(db, 'bot_estado_conversacion', numeroCliente));
    } catch (e) {
        console.error('Error borrando estado de conversación:', e);
    }
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
             (async function() {
                 try {
                     const entry = body.entry && body.entry[0];
                     const changes = entry && entry.changes && entry.changes[0];
                     const value = changes && changes.value;
                     const mensajes = value && value.messages;

                 if (mensajes && mensajes.length > 0) {
                     const mensaje = mensajes[0];
                     const numeroCliente = mensaje.from;
                     const textoRecibido = mensaje.text && mensaje.text.body;
                     const textoNormalizado = (textoRecibido || '').trim().toLowerCase();

                     const catalogo = await obtenerCatalogoActivo();

                     if (catalogo.length === 0) {
                         enviarMensaje(numeroCliente, armarSinCatalogo());
                         registrarInteresado(numeroCliente, textoRecibido, null);
                         res.sendStatus(200);
                         return;
                     }

                     const totalOpciones = catalogo.length + 1;
                     const esVolver = textoNormalizado === 'volver';
                     const esNumero = !esVolver && /^\d+$/.test(textoNormalizado);
                     const estadoPrevio = (esNumero && !esVolver) ? await leerEstadoMenu(numeroCliente) : null;

                     if (esNumero && estadoPrevio && estadoPrevio.menu_ids) {
                         const idx = parseInt(textoNormalizado, 10);

                     if (idx === totalOpciones) {
                         enviarMensaje(numeroCliente, armarNovedades());
                         registrarInteresado(numeroCliente, textoRecibido, 'Novedades');
                         res.sendStatus(200);
                         return;
                     }

                     const idElegido = estadoPrevio.menu_ids[idx - 1];
                         const productoElegido = idElegido ? catalogo.find(p => p.id === idElegido) : null;

                     if (productoElegido) {
                         enviarMensaje(numeroCliente, armarFicha(productoElegido));
                         registrarInteresado(numeroCliente, textoRecibido, productoElegido.nombre);
                         res.sendStatus(200);
                         return;
                     }
                     }

                     enviarMensaje(numeroCliente, armarMenu(catalogo));
                     registrarInteresado(numeroCliente, textoRecibido, null);
                     await guardarEstadoMenu(numeroCliente, catalogo);
                 }
                     res.sendStatus(200);
                 } catch (e) {
                     console.error('Error procesando mensaje entrante:', e);
                     res.sendStatus(200);
                 }
             })();
         } else {
             res.sendStatus(404);
         }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log('CVENTAS Bot corriendo en puerto ' + PORT);
});
