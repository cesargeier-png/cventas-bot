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
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // token de acceso, cargado como variable de entorno en Render
const PHONE_NUMBER_ID = '1257920514073124';

// Links fijos de la marca.
const INSTAGRAM_LINK = 'https://instagram.com/c_ventasoficial';
const FACEBOOK_LINK = 'https://www.facebook.com/profile.php?id=61579064025433';
// Grupo de WhatsApp "C-VENTAS OFICIAL" (embudo minorista) — mismo link ya usado en la bio de
// Instagram y en el mensaje de bienvenida de WhatsApp Business. Confirmado por César, sesión 14/08/2026.
const GRUPO_OFERTAS_LINK = 'https://chat.whatsapp.com/GJElljYLMF14ww8FAxKpbY';
// Número personal de César — recibe el link de "quiero comprar" y (por ahora, mientras sea el único
// que cierra ventas) la notificación de interés. Confirmado por César 07/08/2026.
const NUMERO_CIERRE_VENTA = '543624856124';

// Frase que dispara el catálogo MAYORISTA. Si el texto recibido la contiene (en cualquier parte del
// mensaje, insensible a mayúsculas), se corta cualquier otro flujo y se muestra SOLO el catálogo
// mayorista — un cliente que entra por acá nunca ve ni un producto del catálogo minorista, y
// viceversa (los que ya están en modo minorista no cruzan a mayorista salvo que escriban esta frase).
// Pensado para un link wa.me con este texto precargado, mandado por flyer a la lista de mayoristas.
const FRASE_MAYORISTA = 'mayorista';

// Mismo proyecto Firebase que ya usan sincronizar_proveedores.html / actualizador_precios_v1.html / revisar_alertas.html / catalogo_bot.html (c-ventas)
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

// Sub-paso 1 (Registro de interesados): guarda cada consulta entrante en la colección "bot_interesados".
// "segmento" (minorista/mayorista) queda guardado para poder distinguir el origen en ver_interesados.html.
// No bloquea la respuesta al cliente si Firestore falla (falla en silencio, se loguea y sigue).
async function registrarInteresado(numeroCliente, textoRecibido, nombreProducto, segmento) {
  try {
    await addDoc(collection(db, 'bot_interesados'), {
      numero: numeroCliente,
      mensaje_recibido: textoRecibido || '',
      producto: nombreProducto, // null si todavía no eligió (se le mandó el menú)
      segmento: segmento || 'minorista',
      fecha: serverTimestamp(),
      atendido: false
    });
  } catch (e) {
    console.error('Error registrando interesado en Firestore:', e);
  }
}

// Sub-paso 2 (Selección de producto): trae el catálogo activo desde Firestore,
// cargado por César en catalogo_bot.html (APP/).
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

// Mismo patrón, pero para el catálogo MAYORISTA (colección separada, cargado por César en
// catalogo_bot_mayorista.html — APP/). Nunca se mezcla con catalogo_bot.
async function obtenerCatalogoMayoristaActivo() {
  try {
    const q = query(collection(db, 'catalogo_bot_mayorista'), where('activo', '==', true), orderBy('orden', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Error leyendo catalogo_bot_mayorista de Firestore:', e);
    return [];
  }
}

// Arma la ficha de un producto MINORISTA, con el link de compra (WhatsApp de César, mensaje precargado con el nombre del producto).
function armarFicha(producto) {
  const linkCompra = `https://wa.me/${NUMERO_CIERRE_VENTA}?text=${encodeURIComponent('Hola, me interesa ' + producto.nombre)}`;

  let texto = `*${producto.nombre}*\n\n`;
  texto += `Características:\n`;
  (producto.caracteristicas || []).forEach(function(c) {
    texto += `• ${c}\n`;
  });
  // Sección opcional "Para el día a día" — beneficios reales de uso, separados de las specs
  // técnicas de arriba, para que la ficha no quede fría/distante. Si el producto no tiene
  // beneficios cargados (campo nuevo, opcional en catalogo_bot.html), esta sección no aparece.
  // Directiva de César, 01/09/2026.
  if ((producto.beneficios || []).length > 0) {
    texto += `\n💪 Para el día a día:\n`;
    producto.beneficios.forEach(function(b) {
      texto += `• ${b}\n`;
    });
  }
  texto += `\n✨💰 *Precio contado: ${producto.precio_contado}* 💰✨\n\n`;
  texto += `💳 Financiación:\n`;
  (producto.financiacion || []).forEach(function(f) {
    texto += `• ${f}\n`;
  });
  texto += `\n✅ Si estás interesado, hacé click y en breve te contactamos: ${linkCompra}\n`;
  texto += `\n🔙 Escribí "volver" para ver otras opciones`;
  return texto;
}

// Respuesta cuando el cliente elige un producto MINORISTA marcado "sin stock"
// en catalogo_bot.html (campo sinStock). El producto sigue en el menú con su
// número de siempre — recién acá se entera de que no hay stock, y se lo
// invita a sumarse al grupo de ofertas para enterarse primero la próxima vez
// que este artículo puntual vuelva a entrar. Directiva de César, 31/08/2026.
function armarSinStock(producto) {
  let texto = `😔 Justo te quedaste sin *${producto.nombre}* — no tenemos stock por ahora.\n\n`;
  texto += `Unite al grupo de ofertas y enterate primero cuando vuelva a ingresar este artículo:\n${GRUPO_OFERTAS_LINK}\n`;
  texto += `\n🔙 Escribí "volver" para ver el resto del catálogo`;
  return texto;
}

// Arma la ficha de un producto MAYORISTA — mismo esquema de datos que el minorista (reutiliza
// "financiacion" como campo libre de condiciones: cantidad mínima, forma de pago, etc.), pero con
// otro texto de precio (USD, precio de reventa) y sin sección de financiación en cuotas.
function armarFichaMayorista(producto) {
  const linkCompra = `https://wa.me/${NUMERO_CIERRE_VENTA}?text=${encodeURIComponent('Hola, me interesa (mayorista) ' + producto.nombre)}`;

  let texto = `*${producto.nombre}*\n\n`;
  texto += `Características:\n`;
  (producto.caracteristicas || []).forEach(function(c) {
    texto += `• ${c}\n`;
  });
  texto += `\n💰 Precio mayorista (USD): ${producto.precio_contado}\n`;
  if ((producto.financiacion || []).length > 0) {
    texto += `\n📋 Condiciones:\n`;
    producto.financiacion.forEach(function(f) {
      texto += `• ${f}\n`;
    });
  }
  texto += `\n✅ Si te interesa, hacé click y en breve te contactamos: ${linkCompra}\n`;
  texto += `\n🔙 Escribí "volver" para ver otras opciones`;
  return texto;
}

// Mensaje "Quiénes somos" — se dispara escribiendo la palabra "novedades" (ver esNovedades más abajo),
// ya no es una opción numerada del menú minorista. No existe versión mayorista (audiencia de reventa,
// no tiene sentido mandarla a las redes de venta al público). Texto institucional de base reutilizado
// del mensaje de bienvenida de WhatsApp Business, con el agregado del respaldo mayorista y el bloque
// de compra segura (movido acá desde la ficha del producto, pedido de César 18/08/2026).
function armarNovedades() {
  let texto = `Somos *C-VENTAS* 👋\n`;
  texto += `Más de 10 años en tecnología —comunicación, informática, audio, consolas de juegos, entre otros— trabajando como mayoristas. Ese historial nos avala para arrancar ahora la venta al público.\n\n`;
  texto += `✅ Compra 100% segura:\n`;
  texto += `🔒 Cobro a través del portal Unicobros (Nuevo Banco del Chaco)\n`;
  texto += `🤝 Canal directo, sin intermediarios\n`;
  texto += `🏬 Coordinamos entrega en showroom\n`;
  texto += `🚚 También hacemos envíos\n`;
  texto += `📄 Cada venta emite su comprobante y garantía escrita\n\n`;
  texto += `📸 Instagram: ${INSTAGRAM_LINK}\n`;
  texto += `📘 Facebook: ${FACEBOOK_LINK}\n`;
  texto += `💬 Grupo de ofertas: ${GRUPO_OFERTAS_LINK}\n`;
  texto += `\n🔙 Escribí "volver" para ver los productos`;
  return texto;
}

// Arma el menú numerado MINORISTA: solo productos activos (la opción "Quiénes somos" ya no está
// numerada, se dispara por palabra clave — ver armarNovedades()).
function armarMenu(productos) {
  let texto = `¡Hola! 👋 Bienvenido a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\n`;
  texto += `OFERTAS DISPONIBLES, CONOCÉ LA FINANCIACIÓN\n\n`;
  productos.forEach(function(p, i) {
    texto += `👉 *${i + 1}* ${p.nombre}\n\n`;
  });
  texto += `Respondé con el número de la oferta que te interesa\n`;
  texto += `\n— — —\n📢 Conocé más sobre nosotros — escribí "novedades"`;
  return texto;
}

// Arma el menú numerado MAYORISTA: solo productos activos de catalogo_bot_mayorista, sin "Novedades".
function armarMenuMayorista(productos) {
  let texto = `¡Hola! 👋 Bienvenido a la sección *MAYORISTA* de C-Ventas 📲\nSoy Bencho, tu asistente designado.\n\n`;
  texto += `Estos son los equipos disponibles esta semana para reventa:\n\n`;
  productos.forEach(function(p, i) {
    texto += `${i + 1}) ${p.nombre}\n`;
  });
  texto += `\nRespondé con el número del que te interesa y te paso todos los detalles.`;
  return texto;
}

// Mensaje cuando todavía no hay ningún producto cargado en catalogo_bot.html.
function armarSinCatalogo() {
  return `¡Hola! 👋 Gracias por escribirnos a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\nEn este momento estamos actualizando el catálogo — escribinos en un rato y ya vas a poder ver las opciones disponibles. ¡Gracias por tu paciencia! 🙌`;
}

// Mismo mensaje de espera, versión mayorista (sin productos activos en catalogo_bot_mayorista todavía).
function armarSinCatalogoMayorista() {
  return `¡Hola! 👋 Gracias por escribirnos a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\nEn este momento estamos actualizando la sección mayorista — escribinos en un rato y ya vas a poder ver las opciones disponibles. ¡Gracias por tu paciencia! 🙌`;
}

// Guarda qué menú se le mandó a cada número, junto con el modo (minorista/mayorista), para poder
// interpretar su próxima respuesta ("2", "3"...) contra el catálogo correcto.
async function guardarEstadoMenu(numeroCliente, productos, modo) {
  try {
    await setDoc(doc(db, 'bot_estado_conversacion', numeroCliente), {
      menu_ids: productos.map(p => p.id),
      modo: modo || 'minorista',
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

// Envía un mensaje de texto por la Cloud API a un número dado
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
          const numeroCliente = mensaje.from; // número de quien escribió
          const textoRecibido = mensaje.text && mensaje.text.body; // undefined si no es mensaje de texto (ej. imagen, audio)
          const textoNormalizado = (textoRecibido || '').trim().toLowerCase();

          const esVolver = textoNormalizado === 'volver';
          // Frase mayorista: corta cualquier flujo en curso y arranca (o reinicia) el modo mayorista,
          // sin importar en qué estado estaba la conversación antes.
          const esMayoristaTrigger = !esVolver && textoNormalizado.includes(FRASE_MAYORISTA);
          const esNumero = !esVolver && !esMayoristaTrigger && /^\d+$/.test(textoNormalizado);
          // "novedades" ahora es palabra clave (antes era la última opción numerada del menú minorista).
          const esNovedades = !esVolver && !esMayoristaTrigger && textoNormalizado === 'novedades';

          // --- Entrada explícita al modo MAYORISTA (link con mensaje precargado, o cliente que lo escribe a mano) ---
          if (esMayoristaTrigger) {
            const catalogoMayorista = await obtenerCatalogoMayoristaActivo();
            if (catalogoMayorista.length === 0) {
              enviarMensaje(numeroCliente, armarSinCatalogoMayorista());
              registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
              res.sendStatus(200);
              return;
            }
            enviarMensaje(numeroCliente, armarMenuMayorista(catalogoMayorista));
            registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
            await guardarEstadoMenu(numeroCliente, catalogoMayorista, 'mayorista');
            res.sendStatus(200);
            return;
          }

          // A partir de acá, si hay conversación previa, "modoPrevio" dice qué catálogo corresponde
          // (compatibilidad: estados guardados antes de este cambio no tienen "modo" -> minorista).
          const estadoPrevio = (esNumero || esVolver || esNovedades) ? await leerEstadoMenu(numeroCliente) : null;
          const modoPrevio = (estadoPrevio && estadoPrevio.modo) || 'minorista';

          // --- Responde con un número, dentro de un menú ya enviado ---
          if (esNumero && estadoPrevio && estadoPrevio.menu_ids) {
            const idx = parseInt(textoNormalizado, 10);

            if (modoPrevio === 'mayorista') {
              const catalogoMayorista = await obtenerCatalogoMayoristaActivo();
              const idElegido = estadoPrevio.menu_ids[idx - 1];
              const productoElegido = idElegido ? catalogoMayorista.find(p => p.id === idElegido) : null;
              if (productoElegido) {
                enviarMensaje(numeroCliente, armarFichaMayorista(productoElegido));
                registrarInteresado(numeroCliente, textoRecibido, productoElegido.nombre, 'mayorista');
                res.sendStatus(200);
                return;
              }
              // Número fuera de rango -> vuelve a mandar el menú mayorista actual (cae al bloque de abajo).
              enviarMensaje(numeroCliente, catalogoMayorista.length ? armarMenuMayorista(catalogoMayorista) : armarSinCatalogoMayorista());
              registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
              if (catalogoMayorista.length) await guardarEstadoMenu(numeroCliente, catalogoMayorista, 'mayorista');
              res.sendStatus(200);
              return;
            }

            // modoPrevio === 'minorista' (ya no hay número de "Novedades" — ver esNovedades más abajo)
            const catalogo = await obtenerCatalogoActivo();

            const idElegido = estadoPrevio.menu_ids[idx - 1];
            const productoElegido = idElegido ? catalogo.find(p => p.id === idElegido) : null;

            if (productoElegido) {
              enviarMensaje(numeroCliente, productoElegido.sinStock ? armarSinStock(productoElegido) : armarFicha(productoElegido));
              registrarInteresado(numeroCliente, textoRecibido, productoElegido.nombre, 'minorista');
              res.sendStatus(200);
              return;
            }
            // Número fuera de rango o producto ya no disponible -> vuelve a mandar el menú minorista actual (cae al bloque de abajo).
          }

          // --- "novedades" (Quiénes somos) — palabra clave, solo existe en el flujo minorista ---
          if (esNovedades && modoPrevio === 'minorista') {
            enviarMensaje(numeroCliente, armarNovedades());
            registrarInteresado(numeroCliente, textoRecibido, 'Novedades', 'minorista');
            res.sendStatus(200);
            return;
          }

          // --- "volver" dentro de un modo ya conocido (mayorista) ---
          if (esVolver && modoPrevio === 'mayorista') {
            const catalogoMayorista = await obtenerCatalogoMayoristaActivo();
            if (catalogoMayorista.length === 0) {
              enviarMensaje(numeroCliente, armarSinCatalogoMayorista());
              registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
              res.sendStatus(200);
              return;
            }
            enviarMensaje(numeroCliente, armarMenuMayorista(catalogoMayorista));
            registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
            await guardarEstadoMenu(numeroCliente, catalogoMayorista, 'mayorista');
            res.sendStatus(200);
            return;
          }

          // --- Flujo MINORISTA por defecto (primer contacto sin frase mayorista, "volver" en minorista,
          //     o respuesta no interpretable) — idéntico al comportamiento previo a este build. ---
          const catalogo = await obtenerCatalogoActivo();

          if (catalogo.length === 0) {
            enviarMensaje(numeroCliente, armarSinCatalogo());
            registrarInteresado(numeroCliente, textoRecibido, null, 'minorista');
            res.sendStatus(200);
            return;
          }

          enviarMensaje(numeroCliente, armarMenu(catalogo));
          registrarInteresado(numeroCliente, textoRecibido, null, 'minorista');
          await guardarEstadoMenu(numeroCliente, catalogo, 'minorista');
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
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // token de acceso, cargado como variable de entorno en Render
const PHONE_NUMBER_ID = '1257920514073124';

// Links fijos de la marca.
const INSTAGRAM_LINK = 'https://instagram.com/c_ventasoficial';
const FACEBOOK_LINK = 'https://www.facebook.com/profile.php?id=61579064025433';
// Grupo de WhatsApp "C-VENTAS OFICIAL" (embudo minorista) — mismo link ya usado en la bio de
// Instagram y en el mensaje de bienvenida de WhatsApp Business. Confirmado por César, sesión 14/08/2026.
const GRUPO_OFERTAS_LINK = 'https://chat.whatsapp.com/GJElljYLMF14ww8FAxKpbY';
// Número personal de César — recibe el link de "quiero comprar" y (por ahora, mientras sea el único
// que cierra ventas) la notificación de interés. Confirmado por César 07/08/2026.
const NUMERO_CIERRE_VENTA = '543624856124';

// Frase que dispara el catálogo MAYORISTA. Si el texto recibido la contiene (en cualquier parte del
// mensaje, insensible a mayúsculas), se corta cualquier otro flujo y se muestra SOLO el catálogo
// mayorista — un cliente que entra por acá nunca ve ni un producto del catálogo minorista, y
// viceversa (los que ya están en modo minorista no cruzan a mayorista salvo que escriban esta frase).
// Pensado para un link wa.me con este texto precargado, mandado por flyer a la lista de mayoristas.
const FRASE_MAYORISTA = 'mayorista';

// Mismo proyecto Firebase que ya usan sincronizar_proveedores.html / actualizador_precios_v1.html / revisar_alertas.html / catalogo_bot.html (c-ventas)
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

// Sub-paso 1 (Registro de interesados): guarda cada consulta entrante en la colección "bot_interesados".
// "segmento" (minorista/mayorista) queda guardado para poder distinguir el origen en ver_interesados.html.
// No bloquea la respuesta al cliente si Firestore falla (falla en silencio, se loguea y sigue).
async function registrarInteresado(numeroCliente, textoRecibido, nombreProducto, segmento) {
  try {
    await addDoc(collection(db, 'bot_interesados'), {
      numero: numeroCliente,
      mensaje_recibido: textoRecibido || '',
      producto: nombreProducto, // null si todavía no eligió (se le mandó el menú)
      segmento: segmento || 'minorista',
      fecha: serverTimestamp(),
      atendido: false
    });
  } catch (e) {
    console.error('Error registrando interesado en Firestore:', e);
  }
}

// Sub-paso 2 (Selección de producto): trae el catálogo activo desde Firestore,
// cargado por César en catalogo_bot.html (APP/).
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

// Mismo patrón, pero para el catálogo MAYORISTA (colección separada, cargado por César en
// catalogo_bot_mayorista.html — APP/). Nunca se mezcla con catalogo_bot.
async function obtenerCatalogoMayoristaActivo() {
  try {
    const q = query(collection(db, 'catalogo_bot_mayorista'), where('activo', '==', true), orderBy('orden', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Error leyendo catalogo_bot_mayorista de Firestore:', e);
    return [];
  }
}

// Arma la ficha de un producto MINORISTA, con el link de compra (WhatsApp de César, mensaje precargado con el nombre del producto).
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

// Respuesta cuando el cliente elige un producto MINORISTA marcado "sin stock"
// en catalogo_bot.html (campo sinStock). El producto sigue en el menú con su
// número de siempre — recién acá se entera de que no hay stock, y se lo
// invita a sumarse al grupo de ofertas para enterarse primero la próxima vez
// que este artículo puntual vuelva a entrar. Directiva de César, 31/08/2026.
function armarSinStock(producto) {
  let texto = `😔 Justo te quedaste sin *${producto.nombre}* — no tenemos stock por ahora.\n\n`;
  texto += `Unite al grupo de ofertas y enterate primero cuando vuelva a ingresar este artículo:\n${GRUPO_OFERTAS_LINK}\n`;
  texto += `\n🔙 Escribí "volver" para ver el resto del catálogo`;
  return texto;
}

// Arma la ficha de un producto MAYORISTA — mismo esquema de datos que el minorista (reutiliza
// "financiacion" como campo libre de condiciones: cantidad mínima, forma de pago, etc.), pero con
// otro texto de precio (USD, precio de reventa) y sin sección de financiación en cuotas.
function armarFichaMayorista(producto) {
  const linkCompra = `https://wa.me/${NUMERO_CIERRE_VENTA}?text=${encodeURIComponent('Hola, me interesa (mayorista) ' + producto.nombre)}`;

  let texto = `*${producto.nombre}*\n\n`;
  texto += `Características:\n`;
  (producto.caracteristicas || []).forEach(function(c) {
    texto += `• ${c}\n`;
  });
  texto += `\n💰 Precio mayorista (USD): ${producto.precio_contado}\n`;
  if ((producto.financiacion || []).length > 0) {
    texto += `\n📋 Condiciones:\n`;
    producto.financiacion.forEach(function(f) {
      texto += `• ${f}\n`;
    });
  }
  texto += `\n✅ Si te interesa, hacé click y en breve te contactamos: ${linkCompra}\n`;
  texto += `\n🔙 Escribí "volver" para ver otras opciones`;
  return texto;
}

// Mensaje "Quiénes somos" — se dispara escribiendo la palabra "novedades" (ver esNovedades más abajo),
// ya no es una opción numerada del menú minorista. No existe versión mayorista (audiencia de reventa,
// no tiene sentido mandarla a las redes de venta al público). Texto institucional de base reutilizado
// del mensaje de bienvenida de WhatsApp Business, con el agregado del respaldo mayorista y el bloque
// de compra segura (movido acá desde la ficha del producto, pedido de César 18/08/2026).
function armarNovedades() {
  let texto = `Somos *C-VENTAS* 👋\n`;
  texto += `Más de 10 años en tecnología —comunicación, informática, audio, consolas de juegos, entre otros— trabajando como mayoristas. Ese historial nos avala para arrancar ahora la venta al público.\n\n`;
  texto += `✅ Compra 100% segura:\n`;
  texto += `🔒 Cobro a través del portal Unicobros (Nuevo Banco del Chaco)\n`;
  texto += `🤝 Canal directo, sin intermediarios\n`;
  texto += `🏬 Coordinamos entrega en showroom\n`;
  texto += `🚚 También hacemos envíos\n`;
  texto += `📄 Cada venta emite su comprobante y garantía escrita\n\n`;
  texto += `📸 Instagram: ${INSTAGRAM_LINK}\n`;
  texto += `📘 Facebook: ${FACEBOOK_LINK}\n`;
  texto += `💬 Grupo de ofertas: ${GRUPO_OFERTAS_LINK}\n`;
  texto += `\n🔙 Escribí "volver" para ver los productos`;
  return texto;
}

// Arma el menú numerado MINORISTA: solo productos activos (la opción "Quiénes somos" ya no está
// numerada, se dispara por palabra clave — ver armarNovedades()).
function armarMenu(productos) {
  let texto = `¡Hola! 👋 Bienvenido a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\n`;
  texto += `OFERTAS DISPONIBLES, CONOCÉ LA FINANCIACIÓN\n\n`;
  productos.forEach(function(p, i) {
    texto += `👉 *${i + 1}* ${p.nombre}\n\n`;
  });
  texto += `Indicá el número de la oferta a financiar\n`;
  texto += `\n— — —\n📢 Conocé más sobre nosotros — escribí "novedades"`;
  return texto;
}

// Arma el menú numerado MAYORISTA: solo productos activos de catalogo_bot_mayorista, sin "Novedades".
function armarMenuMayorista(productos) {
  let texto = `¡Hola! 👋 Bienvenido a la sección *MAYORISTA* de C-Ventas 📲\nSoy Bencho, tu asistente designado.\n\n`;
  texto += `Estos son los equipos disponibles esta semana para reventa:\n\n`;
  productos.forEach(function(p, i) {
    texto += `${i + 1}) ${p.nombre}\n`;
  });
  texto += `\nRespondé con el número del que te interesa y te paso todos los detalles.`;
  return texto;
}

// Mensaje cuando todavía no hay ningún producto cargado en catalogo_bot.html.
function armarSinCatalogo() {
  return `¡Hola! 👋 Gracias por escribirnos a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\nEn este momento estamos actualizando el catálogo — escribinos en un rato y ya vas a poder ver las opciones disponibles. ¡Gracias por tu paciencia! 🙌`;
}

// Mismo mensaje de espera, versión mayorista (sin productos activos en catalogo_bot_mayorista todavía).
function armarSinCatalogoMayorista() {
  return `¡Hola! 👋 Gracias por escribirnos a *C-Ventas* 📲\nSoy Bencho, tu asistente designado.\n\nEn este momento estamos actualizando la sección mayorista — escribinos en un rato y ya vas a poder ver las opciones disponibles. ¡Gracias por tu paciencia! 🙌`;
}

// Guarda qué menú se le mandó a cada número, junto con el modo (minorista/mayorista), para poder
// interpretar su próxima respuesta ("2", "3"...) contra el catálogo correcto.
async function guardarEstadoMenu(numeroCliente, productos, modo) {
  try {
    await setDoc(doc(db, 'bot_estado_conversacion', numeroCliente), {
      menu_ids: productos.map(p => p.id),
      modo: modo || 'minorista',
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

// Envía un mensaje de texto por la Cloud API a un número dado
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
          const numeroCliente = mensaje.from; // número de quien escribió
          const textoRecibido = mensaje.text && mensaje.text.body; // undefined si no es mensaje de texto (ej. imagen, audio)
          const textoNormalizado = (textoRecibido || '').trim().toLowerCase();

          const esVolver = textoNormalizado === 'volver';
          // Frase mayorista: corta cualquier flujo en curso y arranca (o reinicia) el modo mayorista,
          // sin importar en qué estado estaba la conversación antes.
          const esMayoristaTrigger = !esVolver && textoNormalizado.includes(FRASE_MAYORISTA);
          const esNumero = !esVolver && !esMayoristaTrigger && /^\d+$/.test(textoNormalizado);
          // "novedades" ahora es palabra clave (antes era la última opción numerada del menú minorista).
          const esNovedades = !esVolver && !esMayoristaTrigger && textoNormalizado === 'novedades';

          // --- Entrada explícita al modo MAYORISTA (link con mensaje precargado, o cliente que lo escribe a mano) ---
          if (esMayoristaTrigger) {
            const catalogoMayorista = await obtenerCatalogoMayoristaActivo();
            if (catalogoMayorista.length === 0) {
              enviarMensaje(numeroCliente, armarSinCatalogoMayorista());
              registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
              res.sendStatus(200);
              return;
            }
            enviarMensaje(numeroCliente, armarMenuMayorista(catalogoMayorista));
            registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
            await guardarEstadoMenu(numeroCliente, catalogoMayorista, 'mayorista');
            res.sendStatus(200);
            return;
          }

          // A partir de acá, si hay conversación previa, "modoPrevio" dice qué catálogo corresponde
          // (compatibilidad: estados guardados antes de este cambio no tienen "modo" -> minorista).
          const estadoPrevio = (esNumero || esVolver || esNovedades) ? await leerEstadoMenu(numeroCliente) : null;
          const modoPrevio = (estadoPrevio && estadoPrevio.modo) || 'minorista';

          // --- Responde con un número, dentro de un menú ya enviado ---
          if (esNumero && estadoPrevio && estadoPrevio.menu_ids) {
            const idx = parseInt(textoNormalizado, 10);

            if (modoPrevio === 'mayorista') {
              const catalogoMayorista = await obtenerCatalogoMayoristaActivo();
              const idElegido = estadoPrevio.menu_ids[idx - 1];
              const productoElegido = idElegido ? catalogoMayorista.find(p => p.id === idElegido) : null;
              if (productoElegido) {
                enviarMensaje(numeroCliente, armarFichaMayorista(productoElegido));
                registrarInteresado(numeroCliente, textoRecibido, productoElegido.nombre, 'mayorista');
                res.sendStatus(200);
                return;
              }
              // Número fuera de rango -> vuelve a mandar el menú mayorista actual (cae al bloque de abajo).
              enviarMensaje(numeroCliente, catalogoMayorista.length ? armarMenuMayorista(catalogoMayorista) : armarSinCatalogoMayorista());
              registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
              if (catalogoMayorista.length) await guardarEstadoMenu(numeroCliente, catalogoMayorista, 'mayorista');
              res.sendStatus(200);
              return;
            }

            // modoPrevio === 'minorista' (ya no hay número de "Novedades" — ver esNovedades más abajo)
            const catalogo = await obtenerCatalogoActivo();

            const idElegido = estadoPrevio.menu_ids[idx - 1];
            const productoElegido = idElegido ? catalogo.find(p => p.id === idElegido) : null;

            if (productoElegido) {
              enviarMensaje(numeroCliente, productoElegido.sinStock ? armarSinStock(productoElegido) : armarFicha(productoElegido));
              registrarInteresado(numeroCliente, textoRecibido, productoElegido.nombre, 'minorista');
              res.sendStatus(200);
              return;
            }
            // Número fuera de rango o producto ya no disponible -> vuelve a mandar el menú minorista actual (cae al bloque de abajo).
          }

          // --- "novedades" (Quiénes somos) — palabra clave, solo existe en el flujo minorista ---
          if (esNovedades && modoPrevio === 'minorista') {
            enviarMensaje(numeroCliente, armarNovedades());
            registrarInteresado(numeroCliente, textoRecibido, 'Novedades', 'minorista');
            res.sendStatus(200);
            return;
          }

          // --- "volver" dentro de un modo ya conocido (mayorista) ---
          if (esVolver && modoPrevio === 'mayorista') {
            const catalogoMayorista = await obtenerCatalogoMayoristaActivo();
            if (catalogoMayorista.length === 0) {
              enviarMensaje(numeroCliente, armarSinCatalogoMayorista());
              registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
              res.sendStatus(200);
              return;
            }
            enviarMensaje(numeroCliente, armarMenuMayorista(catalogoMayorista));
            registrarInteresado(numeroCliente, textoRecibido, null, 'mayorista');
            await guardarEstadoMenu(numeroCliente, catalogoMayorista, 'mayorista');
            res.sendStatus(200);
            return;
          }

          // --- Flujo MINORISTA por defecto (primer contacto sin frase mayorista, "volver" en minorista,
          //     o respuesta no interpretable) — idéntico al comportamiento previo a este build. ---
          const catalogo = await obtenerCatalogoActivo();

          if (catalogo.length === 0) {
            enviarMensaje(numeroCliente, armarSinCatalogo());
            registrarInteresado(numeroCliente, textoRecibido, null, 'minorista');
            res.sendStatus(200);
            return;
          }

          enviarMensaje(numeroCliente, armarMenu(catalogo));
          registrarInteresado(numeroCliente, textoRecibido, null, 'minorista');
          await guardarEstadoMenu(numeroCliente, catalogo, 'minorista');
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
