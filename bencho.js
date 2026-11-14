// bencho.js — Circuito «Me interesa» del catálogo + Agenda de pedidos (14/11/2026, pedido de César).
// El cliente entra SIEMPRE desde el catálogo: el botón «Me interesa» abre WhatsApp con
// «Hola Bencho, me interesa: <artículo> (ref <id>)». Bencho:
//   - a pedido  -> ofrece compra anticipada / pagás al recibir (responde 1 o 2) -> pedido P-xxxx en la Agenda
//   - inmediata -> precio contado + link al vendedor (César) para cerrar
//   - sin stock -> «avisame cuando vuelva»
//   - cliente con pedido abierto que escribe cualquier cosa -> le contesta en qué estado está
//   - «hola» suelto -> se presenta y lo manda a tocar el botón del artículo
// Todo se guarda en la colección bot_interesados (ya tiene reglas; los pedidos llevan tipo = "pedido").
// Bencho NO cierra la venta ni pasa alias: deriva al vendedor (NUMERO_CIERRE_VENTA).

const COEF = 1.37; // Financiero/César 14/11/2026
const VERSION_BENCHO = '14/11 15:25'; // para verificar en el log de Render que tomó la última versión
const TARJETAS = '💳 Trabajamos con *Visa, Mastercard y Tuya* hasta *9 cuotas*, y *Naranja X* en *Plan Z y 6 cuotas*.';
const CATALOGO = 'https://c-ventas.web.app/catalogo_visual.html';
// Zócalo fijo del grupo (Contenido, 01/09/2026) + seguimiento online (César, 14/11/2026)
const ZOCALO = '🏦 *Compra protegida* — Portal *Unicobros* (Nuevo Banco del Chaco)\n' +
  '🚚 *Envío sin cargo* a Resistencia\n' +
  '🏠 También podés retirar por nuestro *showroom*, previo turno agendado\n' +
  '🛡️ Todos nuestros artículos cuentan con *garantía escrita*\n' +
  '📦 Seguí tu pedido *online*, paso a paso, desde tu celular';
const PLAZOS = { '24hs': '24 hs', '5a7': '5 a 7 días hábiles', '7a10': '7 a 10 días hábiles' };
const ESTADOS = { pedido: 'Pedido', transito: 'En tránsito', listo: 'Listo para retiro / entrega', entregado: 'Entregado' };

function ars(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
function linkVendedor(numeroVendedor, texto) { return 'https://wa.me/' + numeroVendedor + '?text=' + encodeURIComponent(texto); }
// 14/11/2026: también los cargados a mano con precio fijo en pesos (publico_ars / base_ars).
function esV2(p) { return Number(p.publico_ars) > 0 || (Number(p.publico_usd) > 0 && Number(p.base_usd) > 0); }
function precioLista(p, tc) { return Number(p.publico_ars) > 0 ? Math.round(Number(p.publico_ars)) : Math.round(Number(p.publico_usd) * tc); }
function precioAntic(p, tc) { return Number(p.publico_ars) > 0 ? Math.round(Number(p.base_ars) || Number(p.publico_ars)) : Math.round(Number(p.base_usd) * tc); }
function codigoPedido() { return 'P-' + String(Math.floor(1000 + Math.random() * 9000)); }
function cuotas(m) { return [3, 6, 9].map(n => n + ' de ' + ars(m * COEF / n)).join(' · '); }

async function leerTC(d) {
  try {
    const s = await d.getDoc(d.doc(d.db, 'estadisticas_catalogo', 'config_tc'));
    const tc = s.exists() ? Number(s.data().tc) : 0;
    return tc > 0 ? tc : 1600;
  } catch (e) { return 1600; }
}

async function pedidosDe(d, numero) {
  const q = d.query(d.collection(d.db, 'bot_interesados'), d.where('numero', '==', numero), d.where('tipo', '==', 'pedido'));
  const snap = await d.getDocs(q);
  const out = [];
  snap.forEach(x => out.push({ id: x.id, ...x.data() }));
  out.sort((a, b) => ((b.fecha && b.fecha.seconds) || 0) - ((a.fecha && a.fecha.seconds) || 0));
  return out;
}

// nombre = nombre de perfil de WhatsApp del cliente (lo manda Meta en el webhook); César lo puede corregir en la Agenda.
async function responder(d, numero, texto, nombrePerfil) {
  console.log('bencho ' + VERSION_BENCHO);
  const nombreCliente = String(nombrePerfil || '').trim();
  const t = String(texto || '').trim();
  // Acepta «1», «1️⃣», «1.» o «opción 1» (lo mismo con 2).
  let tl = t.toLowerCase().replace(/[\ufe0f\u20e3]/g, '').replace(/^(opci[oó]n|la)\s*/, '').replace(/[.!)\s]+$/, '');
  if (!t) return false;

  // 1) Viene del botón «Me interesa» del catálogo
  const ref = t.match(/\(ref ([a-z0-9_\-]+)\)/i);
  if (ref) {
    const id = ref[1];
    const snap = await d.getDoc(d.doc(d.db, 'catalogo_bot', id));
    if (!snap.exists()) {
      d.enviarMensaje(numero, '¡Hola! 👋 Soy Bencho, el asistente de C-Ventas.\nEse artículo ya no está en el catálogo. Mirá lo que tenemos hoy 👇\n\n' + CATALOGO + '\n');
      return true;
    }
    const p = snap.data();
    const nombre = p.nombre || id;
    const tc = await leerTC(d);
    const sinStock = esV2(p) ? p.entrega === 'sin_stock' : (p.sinStock === true || p.disponibilidad === 'sin_stock');
    if (sinStock) {
      await d.addDoc(d.collection(d.db, 'bot_interesados'), { tipo: 'avisar', numero, nombre: nombreCliente, producto: nombre, producto_id: id, mensaje_recibido: t, segmento: 'minorista', avisar_cuando_vuelva: true, fecha: d.serverTimestamp(), atendido: false });
      d.enviarMensaje(numero, '¡Hola! 👋 Soy Bencho, el asistente de C-Ventas.\nEl *' + nombre + '* está sin stock en este momento.\n¡Anotado! 📝 Apenas vuelva te aviso por acá.');
      return true;
    }
    if (esV2(p) && p.entrega !== 'inmediata' && precioAntic(p, tc) < precioLista(p, tc)) {
      const reemb = precioLista(p, tc);
      const antic = precioAntic(p, tc);
      const plazo = PLAZOS[p.entrega] || PLAZOS['5a7'];
      await d.addDoc(d.collection(d.db, 'bot_interesados'), {
        tipo: 'pedido', estado: 'esperando_forma', pago: 'pendiente', numero, nombre: nombreCliente, producto: nombre, producto_id: id,
        precio_anticipada: antic, precio_reembolso: reemb, plazo, mensaje_recibido: t, segmento: 'minorista',
        fecha: d.serverTimestamp(), atendido: false
      });
      d.enviarMensaje(numero,
        '¡Hola! 👋 Soy Bencho, el asistente de C-Ventas.\n' +
        'El *' + nombre + '* lo traemos a pedido y llega en ' + plazo + '. Tenés dos formas:\n\n' +
        '1️⃣ *Compra anticipada: 🔥 ' + ars(antic) + '*, un precio increíble que no conseguís en ninguna otra tienda.\nPagás ahora y ahorrás *' + ars(reemb - antic) + '*.\nTambién en cuotas: ' + cuotas(antic) + '\n\n' +
        '2️⃣ *Pagás al recibirlo: ' + ars(reemb) + '*\nEn cuotas: ' + cuotas(reemb) + '\n\n' +
        TARJETAS + '\n' + ZOCALO + '\n\n\n*RESPONDÉ 1️⃣ o 2️⃣*');
      return true;
    }
    // Entrega inmediata
    let contado, listaCuotas;
    listaCuotas = esV2(p) ? precioLista(p, tc) : (Number(p.precio_lista) > 0 ? Number(p.precio_lista) : 0);
    if (esV2(p)) contado = (p.oferta_activa && Number(p.oferta_valor) > 0) ? Number(p.oferta_valor) : precioLista(p, tc);
    else contado = Number(p.precio_lista) > 0 ? Number(p.precio_lista) : parseInt(String(p.precio_contado || '').replace(/[^0-9]/g, ''), 10) || 0;
    await d.addDoc(d.collection(d.db, 'bot_interesados'), { tipo: 'interes', numero, nombre: nombreCliente, producto: nombre, producto_id: id, mensaje_recibido: t, segmento: 'minorista', fecha: d.serverTimestamp(), atendido: false });
    d.enviarMensaje(numero,
      '¡Hola! 👋 Soy Bencho, el asistente de C-Ventas.\n' +
      (esV2(p) && p.entrega && p.entrega !== 'inmediata'
        ? 'El *' + nombre + '* lo traemos a pedido y llega en ' + (PLAZOS[p.entrega] || PLAZOS['5a7']) + (contado ? '. Tiene un solo precio:\n' : '.\n')
        : 'El *' + nombre + '* cuenta con *entrega inmediata*' + (contado ? ' y tiene un solo precio:\n' : '.\n')) +
      // Si por algún motivo el artículo no tiene precio cargado, no se manda «un solo precio:» vacío.
      (contado ? '' : 'El precio te lo pasa nuestro vendedor en un minuto 👇\n') +
      (contado ? '💵 *' + ars(contado) + '* (contado, transferencia o efectivo)\n' : '') +
      ((listaCuotas || contado) ? 'En cuotas: ' + cuotas(listaCuotas || contado) + '\n' : '') +
      TARJETAS + '\n' + ZOCALO + '\n\n' +
      'Para cerrar la compra, escribile a nuestro vendedor acá 👇\n\n' +
      linkVendedor(d.NUMERO_CIERRE_VENTA, 'Hola, quiero comprar el ' + nombre) + '\n');
    return true;
  }

  // 2) Pedidos de este número (para «1»/«2» y para contestar el estado)
  let pedidos = [];
  try { pedidos = await pedidosDe(d, numero); } catch (e) { console.log('bencho pedidosDe: ' + e.message); }

  if (tl === '1' || tl === '2') {
    // Si ya eligió y todavía no pagó, puede cambiar de forma (1 <-> 2) sobre el MISMO pedido (mismo código).
    const esp = pedidos.find(x => x.estado === 'esperando_forma') ||
      pedidos.find(x => x.estado === 'pedido' && x.pago !== 'pagado' && x.forma);
    if (!esp) return false;
    const forma = tl === '1' ? 'anticipada' : 'reembolso';
    const cambio = esp.estado === 'pedido';
    const codigo = esp.codigo || codigoPedido();
    await d.updateDoc(d.doc(d.db, 'bot_interesados', esp.id), cambio
      ? { forma, forma_cambiada: true }
      : { estado: 'pedido', forma, codigo, pago: 'pendiente', fecha_pedido: d.serverTimestamp() });
    const otra = forma === 'anticipada' ? '2️⃣ para pagar al recibirlo' : '1️⃣ para la compra anticipada';
    const formaTxt = forma === 'anticipada' ? 'compra anticipada, ' + ars(esp.precio_anticipada) : 'pagás al recibir, ' + ars(esp.precio_reembolso);
    d.enviarMensaje(numero,
      (cambio ? '¡Listo! 🔄 Cambiamos tu pedido *' + codigo + '* a ' + formaTxt + '.\n' : '¡Listo! ✅ Tu pedido es el *' + codigo + '* (' + formaTxt + ').\n') +
      'Para confirmarlo, escribile a nuestro vendedor acá 👇\n\n' +
      linkVendedor(d.NUMERO_CIERRE_VENTA, 'Hola, quiero cerrar el pedido ' + codigo + ': ' + esp.producto + ', ' + formaTxt) + '\n\n\n' +
      '¿Cambiaste de idea? *RESPONDÉ* ' + otra + '.');
    return true;
  }

  // 3) Tiene un pedido abierto: le contamos cómo va
  const abierto = pedidos.find(x => ['pedido', 'transito', 'listo'].includes(x.estado));
  if (abierto) {
    const pago = abierto.pago === 'pagado' ? 'Pagado' : 'Pendiente de pago';
    d.enviarMensaje(numero,
      '¡Hola! 👋 Tu pedido *' + (abierto.codigo || '') + '* de *' + abierto.producto + '* está:\n*' + (ESTADOS[abierto.estado] || 'Pedido') + ' · ' + pago + '*\n' +
      (abierto.estado === 'listo' ? '¡Ya lo podés retirar o coordinar la entrega con nuestro vendedor!' : 'Apenas esté listo te avisamos por acá.'));
    return true;
  }

  // 4) «Hola» suelto (botón Bencho del catálogo)
  if (/^(hola|buenas|buen d[ií]a|buenas tardes|buenas noches)[!. ]*$/i.test(t)) {
    d.enviarMensaje(numero, '¡Hola! 👋 Soy Bencho, el asistente de C-Ventas.\nTocá *Me interesa* en el artículo que te guste del catálogo y te sigo desde ahí 😉\n\n' + CATALOGO + '\n');
    return true;
  }
  return false;
}

module.exports = { responder, COEF, TARJETAS };
