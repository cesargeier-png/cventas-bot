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
const MSG_CERRADO = 'Este Drop está cerrado 🔒 Quedate atento a los próximos avisos. 💧 Apenas se abra el próximo, te enteramos primero.';

// Anota a la persona en la lista de espera del próximo Drop (colección propia del Drop: drop_espera).
async function anotarProximo(deps, numero, texto) {
  try { if (deps.anotarEspera) await deps.anotarEspera(numero, texto); }
  catch (e) { deps.log('Drop: no se pudo anotar en la lista de espera: ' + e.message); }
}

function armarEstado(ofertas) {
  const lista = (Array.isArray(ofertas) ? ofertas : (ofertas ? [ofertas] : [])).filter(function (o) { return o && !o.oculto; });
  const abiertas = lista.filter(function (o) { return o.estado === 'abierto'; })
    .sort(function (a, b) { return cierreMs(a) - cierreMs(b); });
  if (!abiertas.length) return MSG_CERRADO;
  const bloques = abiertas.map(function (o) {
    const quedan = Math.max(0, o.cupo - o.reservadas);
    const c = cierreTxt(o);
    return '📱 ' + o.equipo + '\n' + plata(o, o.precio_usd) + ' cada una · Quedan ' + quedan + ' de ' + o.cupo + (c ? '\nSe cierra el ' + c + ' hs.' : '');
  });
  return '💧 Drop de C-Ventas\n\n' + bloques.join('\n\n')
    + '\n\nPara sumarte o ver tu reserva:\n\n👇 ' + DROP_LINK + ' 👇\n\nSi ya reservaste, escribime tu código (se ve así: D-AB12) y te confirmo todo.';
}
function cierreMs(o) { try { return o.cierre.toMillis(); } catch (e) { return 9e15; } }

function usd(n) { return Number(n).toLocaleString('es-AR'); }
function plata(o, n) { return (o && o.moneda === 'ARS' ? '$ ' : 'USD ') + usd(n); }

function armarRespuesta(reserva, drop, otras) {
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
    + 'Precio: ' + plata(drop, drop.precio_usd) + ' cada una\n'
    + 'Total: ' + plata(drop, total) + '\n\n'
    + 'Cómo funciona:\n'
    + '• Pagás cuando recibís la mercadería. No hay seña.\n'
    + '• Tu participación es anónima: solo César sabe cuántos equipos sumaste. Nadie más ve tu compra ni tu precio.\n'
    + '• Es un compromiso de compra: el Drop se concreta si entre todos completamos las ' + drop.cupo + ' unidades.\n'
    + situacion + '\n\n'
    + armarOtras(otras)
    + '¡Gracias por sumarte!';
}

// Otras reservas del mismo cliente en otras ofertas (para que vea todo su pedido junto).
function armarOtras(otras) {
  if (!otras || !otras.length) return '';
  return 'También tenés reservado:\n' + otras.map(function (x) {
    return '• ' + x.oferta.equipo + ': ' + x.reserva.unidades + ' un. (' + plata(x.oferta, x.reserva.unidades * Number(x.oferta.precio_usd)) + ')';
  }).join('\n') + '\n\n';
}

function armarNoEncontrado() {
  return 'No encuentro ese código de reserva. 🤔 Revisá que esté bien escrito (se ve así: D-AB12) o volvé a tocar el botón desde la página del Drop.\n\n'
    + 'Si el problema sigue, escribinos al ' + NUMERO_NEGOCIO + ' y lo resolvemos.';
}

function armarDropTerminado() {
  return MSG_CERRADO + '\n\nCualquier duda, escribinos al ' + NUMERO_NEGOCIO + '.';
}

// Devuelve true si el mensaje era de un Drop y ya se contestó (el bot no sigue con otros flujos).
// deps: leerDrops() (lista de ofertas), buscarReserva(codigo), enviar(numero, texto), registrarInteresado(numero, mensaje, producto, extra), log(msg)
async function responderDrop(deps, numero, texto) {
  const codigo = extraerCodigo(texto);
  if (!codigo) {
    if (!esConsultaDrop(texto)) return false;
    try {
      const ofs = (await deps.leerDrops()) || [];
      deps.enviar(numero, armarEstado(ofs));
      if (!ofs.some(function (o) { return o && !o.oculto && o.estado === 'abierto'; })) await anotarProximo(deps, numero, texto);
    }
    catch (e) { deps.log('Drop: error: ' + e.message); deps.enviar(numero, 'Ahora no puedo ver el estado del Drop. Escribinos al ' + NUMERO_NEGOCIO + ' y te contamos.'); }
    return true;
  }
  try {
    const reserva = await deps.buscarReserva(codigo);
    if (!reserva) { deps.enviar(numero, armarNoEncontrado()); return true; }
    const ofertas = (await deps.leerDrops()) || [];
    const drop = ofertas.find(function (o) { return o.id_oferta === reserva.id_oferta; });
    if (!drop) { deps.enviar(numero, armarDropTerminado()); await anotarProximo(deps, numero, texto); return true; }
    let otras = [];
    try {
      if (deps.buscarReservasDeCliente && reserva.cid) {
        const todas = (await deps.buscarReservasDeCliente(reserva.cid)) || [];
        otras = todas.filter(function (r) { return r.id_oferta !== reserva.id_oferta && r.unidades > 0; })
          .map(function (r) { return { reserva: r, oferta: ofertas.find(function (o) { return o.id_oferta === r.id_oferta; }) }; })
          .filter(function (x) { return x.oferta; });
      }
    } catch (e) { deps.log('Drop: no se pudieron buscar otras reservas: ' + e.message); }
    deps.enviar(numero, armarRespuesta(reserva, drop, otras));
    try { if (deps.guardarWhatsapp) await deps.guardarWhatsapp(codigo, numero); } catch (e) { deps.log('Drop: no se pudo guardar el WhatsApp de la reserva: ' + e.message); }
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
