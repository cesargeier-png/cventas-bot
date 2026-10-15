// Drop (compra en bloque) — respuesta de Bencho cuando el cliente escribe con su código de reserva.
// Diseñado con César el 13-14/10/2026. El cliente reserva en c-ventas.web.app/drop.html y toca
// "Avisar a César": se abre este WhatsApp con un mensaje que incluye su código (ej. D-3RBM).
// Todo en palabras comunes, sin jerga. No usa Claude: es una respuesta fija, sin costo.

const NUMERO_NEGOCIO = '3624742635';
const CODIGO_RE = /\bD-[A-Z0-9]{4}\b/i;

function extraerCodigo(texto) {
  const m = (texto || '').match(CODIGO_RE);
  return m ? m[0].toUpperCase() : null;
}

const DROP_LINK = 'https://c-ventas.web.app/drop.html?v=3';
function esConsultaDrop(texto) { return /\bdrop\b/i.test(texto || ''); }

function cierreTxt(o) {
  try { return o.cierre.toDate().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return ''; }
}

// Estado de TODAS las ofertas abiertas (puede haber varias a la vez, cada una con su cupo y su cierre).
function armarEstado(ofertas) {
  const lista = (Array.isArray(ofertas) ? ofertas : (ofertas ? [ofertas] : [])).filter(function (o) { return o && !o.oculto; });
  const abiertas = lista.filter(function (o) { return o.estado === 'abierto'; })
    .sort(function (a, b) { return cierreMs(a) - cierreMs(b); });
  if (!abiertas.length) return 'Por ahora no hay un Drop abierto. 💧 Cuando se abra uno, te enteramos primero.';
  const bloques = abiertas.map(function (o) {
    const quedan = Math.max(0, o.cupo - o.reservadas);
    const c = cierreTxt(o);
    return '📱 ' + o.equipo + '\nUSD ' + usd(o.precio_usd) + ' cada una · Quedan ' + quedan + ' de ' + o.cupo + (c ? '\nSe cierra el ' + c + ' hs.' : '');
  });
  return '💧 Drop de C-Ventas\n\n' + bloques.join('\n\n')
    + '\n\nPara sumarte o ver tu reserva:\n\n👇 ' + DROP_LINK + ' 👇\n\nSi ya reservaste, escribime tu código (se ve así: D-AB12) y te confirmo todo.';
}
function cierreMs(o) { try { return o.cierre.toMillis(); } catch (e) { return 9e15; } }

function usd(n) { return Number(n).toLocaleString('es-AR'); }

function armarRespuesta(reserva, drop) {
  const nombre = (reserva.nombre || '').trim().split(/\s+/)[0] || '';
  const total = reserva.unidades * Number(drop.precio_usd);
  const estado = drop.estado;
  let situacion;
  if (estado === 'completo') {
    situacion = '• ¡Se completó el cupo de ' + drop.cupo + ' unidades! Te avisamos apenas llegue la mercadería.';
  } else if (estado === 'cerrado') {
    situacion = '• El cupo ya cerró con ' + drop.reservadas + ' de ' + drop.cupo + ' unidades. Te avisamos cómo seguimos.';
  } else if (estado === 'cerrado_sin_completar') {
    situacion = '• El Drop cerró sin completar el cupo (' + drop.reservadas + ' de ' + drop.cupo + '). Estamos viendo cómo seguimos y te avisamos.';
  } else {
    situacion = '• Hoy van ' + drop.reservadas + ' de ' + drop.cupo + ' unidades. Mientras siga abierto podés sumar más unidades al mismo precio.\n'
              + '• Te avisamos cuando se cierre el cupo y cuando llegue la mercadería.';
  }
  return '¡Hola' + (nombre ? ' ' + nombre : '') + '! 💧 Tu lugar en el Drop quedó confirmado.\n\n'
    + '📱 ' + drop.equipo + '\n'
    + 'Unidades: ' + reserva.unidades + '\n'
    + 'Precio: USD ' + usd(drop.precio_usd) + ' cada una\n'
    + 'Total: USD ' + usd(total) + '\n\n'
    + 'Cómo funciona:\n'
    + '• Pagás cuando recibís la mercadería. No hay seña.\n'
    + '• Tu participación es anónima: solo César sabe cuántos equipos sumaste. Nadie más ve tu compra ni tu precio.\n'
    + '• Es un compromiso de compra: el Drop se concreta si entre todos completamos las ' + drop.cupo + ' unidades.\n'
    + situacion + '\n\n'
    + '¡Gracias por sumarte!';
}

function armarNoEncontrado() {
  return 'No encuentro ese código de reserva. 🤔 Revisá que esté bien escrito (se ve así: D-AB12) o volvé a tocar el botón desde la página del Drop.\n\n'
    + 'Si el problema sigue, escribinos al ' + NUMERO_NEGOCIO + ' y lo resolvemos.';
}

function armarDropTerminado() {
  return 'Ese código es de un Drop anterior, que ya terminó. 💧 Si querés sumarte al que está abierto, entrá de nuevo a la página y reservá.\n\n'
    + 'Cualquier duda, escribinos al ' + NUMERO_NEGOCIO + '.';
}

// Devuelve true si el mensaje era de un Drop y ya se contestó (el bot no sigue con otros flujos).
// deps: leerDrops() (lista de ofertas), buscarReserva(codigo), enviar(numero, texto), registrarInteresado(numero, mensaje, producto, extra), log(msg)
async function responderDrop(deps, numero, texto) {
  const codigo = extraerCodigo(texto);
  if (!codigo) {
    if (!esConsultaDrop(texto)) return false;
    try { deps.enviar(numero, armarEstado(await deps.leerDrops())); }
    catch (e) { deps.log('Drop: error: ' + e.message); deps.enviar(numero, 'Ahora no puedo ver el estado del Drop. Escribinos al ' + NUMERO_NEGOCIO + ' y te contamos.'); }
    return true;
  }
  try {
    const reserva = await deps.buscarReserva(codigo);
    if (!reserva) { deps.enviar(numero, armarNoEncontrado()); return true; }
    const ofertas = (await deps.leerDrops()) || [];
    const drop = ofertas.find(function (o) { return o.id_oferta === reserva.id_oferta; });
    if (!drop) { deps.enviar(numero, armarDropTerminado()); return true; }
    deps.enviar(numero, armarRespuesta(reserva, drop));
    try { await deps.registrarInteresado(numero, texto, 'Drop: ' + drop.equipo, { origen: 'drop', codigo: codigo, unidades: reserva.unidades, nombre: reserva.nombre || '' }); } catch (e) { deps.log('Drop: no se pudo registrar interesado: ' + e.message); }
    return true;
  } catch (e) {
    // Si Firestore falla (ej. reglas sin habilitar), no se queda mudo: avisa y deriva al número del negocio.
    deps.log('Drop: error: ' + e.message);
    deps.enviar(numero, 'Recibimos tu mensaje del Drop. 💧 En un momento te confirmamos tu reserva. Si tarda, escribinos al ' + NUMERO_NEGOCIO + '.');
    return true;
  }
}

module.exports = { esConsultaDrop, armarEstado, extraerCodigo, armarRespuesta, armarNoEncontrado, armarDropTerminado, responderDrop };
