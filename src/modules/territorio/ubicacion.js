/**
 * Ubicacion de un domicilio del padron en una manzana (018).
 *
 * Funciones puras: sin red, sin base, sin process.env. Las usan el servicio del modulo (en lote, al
 * importar el padron o al cargar las capas) y scripts/medir-geocodificacion.js. Mudadas sin cambios de
 * comportamiento desde ese script, donde se midieron contra el padron real de Alcira (73 % ubicado) y se
 * verifico el lado de la calle contra Google Maps.
 *
 * Como funciona:
 *   1. El eje de calles trae un tramo por cuadra, con la altura inicial y final de cada lado
 *      (izquierdo = impares, derecho = pares). Se busca el tramo cuyo rango contiene el numero.
 *   2. Las lineas del eje NO estan dibujadas en el sentido de la numeracion, asi que se deduce
 *      encadenando las cuadras vecinas de la misma calle (ver `orientar`).
 *   3. Se interpola el punto sobre la cuadra y se corre unos metros hacia el lado que le toca
 *      (impares a la izquierda al crecer la numeracion, como en toda la Argentina).
 *   4. Se ve en que poligono de manzana cae ese punto.
 * Lo que no se puede resolver queda como PENDIENTE con su motivo; nunca se inventa un punto.
 */

const M_LAT = 111320; // metros por grado de latitud

// ------------------------------------------------------------------ texto

const quitarAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Caracteres de cp1252 que no son latin1, para deshacer el "mojibake" (UTF-8 leido como cp1252
// y vuelto a codificar, a veces varias veces). Una calle del eje viene asi: "DR ACUÃƒÆ'...A".
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function repararMojibake(texto) {
  let actual = String(texto || '');
  for (let i = 0; i < 5 && /[ÃÂ]/.test(actual); i += 1) {
    const bytes = [];
    for (const c of actual) {
      const codigo = c.codePointAt(0);
      if (codigo < 256) bytes.push(codigo);
      else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
      else return actual; // un caracter que no viene de este error: se deja como esta
    }
    const siguiente = Buffer.from(bytes).toString('utf8');
    if (siguiente === actual || siguiente.includes('�')) return actual;
    actual = siguiente;
  }
  return actual;
}

// Titulos, tipos de via y abreviaturas, llevados a una sola forma. Un tipo de via ("CALLE", "AV") se
// descarta; un titulo ("GRL", "DR", "INT") se conserva pero NO cuenta al comparar: el padron escribe
// "INTENDENTE ACUNA" y el callejero "DR ACUNA", y es la misma calle.
const TITULOS = {
  GRAL: 'GRL', GRL: 'GRL', GENERAL: 'GRL', DR: 'DR', DRA: 'DR', DOCTOR: 'DR', DOCTORA: 'DR', ING: 'ING', INGENIERO: 'ING',
  CNEL: 'CNEL', CORONEL: 'CNEL', PRES: 'PRES', PRESIDENTE: 'PRES', GOB: 'GOB', GOBERNADOR: 'GOB',
  PBRO: 'PBRO', PADRE: 'PBRO', MONS: 'MONS', MONSENOR: 'MONS', INT: 'INT', INTENDENTE: 'INT',
  MTRA: 'MTRA', MAESTRA: 'MTRA', MTRO: 'MTRO', MAESTRO: 'MTRO', PROF: 'PROF', PROFESOR: 'PROF', PROFESORA: 'PROF', FRAY: 'FRAY',
  AV: '', AVDA: '', AVENIDA: '', CALLE: '', PJE: '', PASAJE: '', BV: '', BVARD: '', BVAR: '', BOULEVARD: '', DIAG: '', DIAGONAL: '',
};
const ES_TITULO = new Set(Object.values(TITULOS).filter(Boolean));
const ABREVIATURAS = { SGO: 'SANTIAGO', STGO: 'SANTIAGO', STA: 'SANTA', STO: 'SANTO' };
const RELLENO = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y']);

function tokens(texto) {
  return quitarAcentos(repararMojibake(texto)).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .map((t) => (t in ABREVIATURAS ? ABREVIATURAS[t] : t))
    .map((t) => (t in TITULOS ? TITULOS[t] : t))
    .filter((t) => t && !RELLENO.has(t));
}

/** Texto de un domicilio listo para comparar: sin caracteres rotos, sin acentos, en mayusculas. */
function limpiar(domicilio) {
  return quitarAcentos(repararMojibake(String(domicilio || ''))).toUpperCase().replace(/\bS\s*\/\s*N\b/g, ' SN ').replace(/\s+/g, ' ').trim();
}

/**
 * "ESTEBAN PIACENZA 596" -> { calle: 'ESTEBAN PIACENZA', numero: 596 }; null si no hay numero.
 * Acepta texto despues del numero ("274 CENTRO", "625 BELLA VISTA", "323 PA"). El numero 0 es como el
 * padron escribe "sin numero": se devuelve tal cual y el resolver lo trata aparte.
 */
function partirDomicilio(domicilio) {
  const limpio = limpiar(domicilio);
  // Primero el numero al final (admite DPTO/PISO): es lo mas seguro, "CALLE 5 456" es la calle 5, numero 456.
  let m = limpio.match(/^(.*?)\s+(?:N[°º.]?\s*)?(\d{1,5})(?:\s*(?:BIS|[A-Z]))?(?:\s+(?:DPTO|DEPTO|PISO|LOTE|MZA|MANZANA)\b.*)?$/);
  // Si no, el primer numero que haya, con el barrio o lo que sea que venga despues.
  if (!m) {
    m = limpio.match(/^(.*?[A-Z].*?)\s+(?:N[°º.]?\s*)?(\d{1,5})\b(?:\s(.*))?$/);
    // "RUTA 36 S/N": ese 36 es parte del nombre y lo que sigue dice que no hay numero de casa.
    if (m && /\bSN\b/.test(m[3] || '')) return null;
  }
  if (!m || !m[1] || !/[A-Z]/.test(m[1])) return null;
  return { calle: m[1], numero: Number.parseInt(m[2], 10) };
}

const esRural = (domicilio) => /^(ZONA\s+)?RURAL\b|^CAMPO\b|\bZONA RURAL\b/.test(limpiar(domicilio));

/** Distancia de edicion, cortada: solo interesa saber si es 0 o 1. */
function distancia1(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) ? 1 : 2;
  const [corta, larga] = a.length < b.length ? [a, b] : [b, a];
  return corta.slice(i) === larga.slice(i + 1) ? 1 : 2;
}

/** Dos terminos son el mismo si son iguales o, siendo largos, difieren en una letra ("PIAZOLA"/"PIAZZOLA"). */
const mismoTermino = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && distancia1(a, b) <= 1);

/** Terminos que cuentan al comparar: sin iniciales sueltas ni titulos (salvo que no quede otra cosa). */
function terminos(lista) {
  const utiles = lista.filter((t) => t.length > 1 || /\d/.test(t));
  const sinTitulo = utiles.filter((t) => !ES_TITULO.has(t));
  return sinTitulo.length ? sinTitulo : utiles;
}

/**
 * Nombres del eje que pueden ser la calle pedida, del mas parecido al menos. Dos nombres son
 * "la misma calle" si los terminos de uno estan todos en el otro, sin contar iniciales ni titulos:
 * "GRAL JOSE MARIA PAZ" y "GRL PAZ" coinciden, igual que "INTENDENTE ACUNA" y "DR ACUNA".
 * Con `permitirAproximadas`, si nada coincide asi se ofrece —marcada `aproximada`— una calle cuyo ULTIMO
 * termino (el apellido) sea el mismo: "M MIGUEL DE GUEMES" y "MARTIN DE GUEMES". NO se usa por defecto:
 * tambien haria coincidir "JUAN PEREZ" (una calle que el callejero no tiene) con "MTRA DIAZ PEREZ", y un
 * punto equivocado es peor que un pendiente. El resolver las informa como "calle parecida".
 */
function candidatas(calle, nombres, permitirAproximadas = false) {
  const a = terminos(tokens(calle));
  const salida = [];
  if (!a.length) return salida;

  for (const [nombre, k] of nombres) {
    const b = terminos(k);
    if (!b.length) continue;
    const comunes = b.filter((t) => a.some((u) => mismoTermino(t, u))).length;
    if (comunes === 0 || (comunes !== b.length && comunes !== a.length)) continue;
    salida.push({ nombre, score: comunes / Math.max(a.length, b.length), aproximada: false });
  }
  if (salida.length) return salida.sort((x, y) => y.score - x.score);

  if (permitirAproximadas && a.length >= 2 && a[a.length - 1].length >= 4) {
    for (const [nombre, k] of nombres) {
      const b = terminos(k);
      if (b.length >= 2 && mismoTermino(b[b.length - 1], a[a.length - 1])) salida.push({ nombre, score: 0.5, aproximada: true });
    }
  }
  return salida;
}

// ------------------------------------------------------------------ geometria

const metros = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * M_LAT);

/** Punto a la fraccion `f` (0..1) de la longitud de una polilinea, con su direccion unitaria en metros. */
function sobreLinea(camino, f) {
  const largos = [];
  let total = 0;
  for (let i = 0; i < camino.length - 1; i += 1) {
    const l = metros(camino[i], camino[i + 1]);
    largos.push(l);
    total += l;
  }
  let falta = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < largos.length; i += 1) {
    if (falta <= largos[i] || i === largos.length - 1) {
      const t = largos[i] ? Math.min(1, falta / largos[i]) : 0;
      const p = [camino[i][0] + (camino[i + 1][0] - camino[i][0]) * t, camino[i][1] + (camino[i + 1][1] - camino[i][1]) * t];
      const dx = (camino[i + 1][0] - camino[i][0]) * M_LAT * Math.cos((p[1] * Math.PI) / 180);
      const dy = (camino[i + 1][1] - camino[i][1]) * M_LAT;
      const largo = Math.hypot(dx, dy) || 1;
      return { punto: p, ux: dx / largo, uy: dy / largo };
    }
    falta -= largos[i];
  }
  return null;
}

/** Punto en poligono por paridad de cruces (los anillos huecos de ArcGIS restan solos). */
function puntoEnPoligono(punto, anillos) {
  let dentro = false;
  for (const anillo of anillos) {
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i += 1) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      if ((yi > punto[1]) !== (yj > punto[1]) && punto[0] < ((xj - xi) * (punto[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
  }
  return dentro;
}

function cajaDe(anillos) {
  let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
  for (const a of anillos) for (const [x, y] of a) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
  return [minx, miny, maxx, maxy];
}

// ------------------------------------------------------------------ indice y resolucion

// A partir de esta numeracion el sentido se puede estimar por la cercania al centro (ver `orientar`).
const NUMERACION_ALTA = 600;
const ALTURA_MIN = (t) => Math.min(t.aii > 0 ? t.aii : Infinity, t.aid > 0 ? t.aid : Infinity);

/**
 * Orienta cada tramo de menor a mayor numeracion encadenando las cuadras de la misma calle:
 * el extremo "bajo" de una cuadra es el que toca a la anterior. `t.bajo` es 0 (el primer punto
 * de la linea es el numero menor), 1 (el ultimo) o null (no hay vecino que lo diga).
 *
 * Ultimo recurso, `estimarSentido`: en una cuadra aislada de numeracion alta (600 o mas) el numero menor
 * esta del lado del centro del pueblo. Medido contra las cuadras cuyo sentido SE conoce, acierta el 99 %
 * en Alcira y en Berrotaran (en las cuadras bajas solo 45-84 %, por eso ahi no se usa). Esas cuadras
 * quedan marcadas `estimado`.
 */
function orientar(porCalle, estimarSentido = true) {
  const extremos = (t) => [t.camino[0], t.camino[t.camino.length - 1]];
  for (const lista of porCalle.values()) {
    const ordenados = lista.filter((t) => ALTURA_MIN(t) < Infinity).sort((a, b) => ALTURA_MIN(a) - ALTURA_MIN(b));
    ordenados.forEach((t, i) => {
      t.bajo = null;
      const [e0, e1] = extremos(t);
      if (i > 0) {
        const [p0, p1] = extremos(ordenados[i - 1]);
        const d = [metros(e0, p0), metros(e0, p1), metros(e1, p0), metros(e1, p1)];
        if (Math.min(...d) <= 15) t.bajo = Math.min(d[0], d[1]) <= Math.min(d[2], d[3]) ? 0 : 1;
      } else if (ordenados.length > 1) {
        const [n0, n1] = extremos(ordenados[1]);
        const d0 = Math.min(metros(e0, n0), metros(e0, n1));
        const d1 = Math.min(metros(e1, n0), metros(e1, n1));
        if (Math.min(d0, d1) <= 15) t.bajo = d0 > d1 ? 0 : 1;
      }
    });

    // Respaldo para las cuadras que no se tocan con su vecina (hay un hueco en el dibujo): la
    // numeracion crece hacia donde esta la cuadra siguiente, asi que se compara el sentido de la
    // linea con el vector que va de la cuadra anterior (o a la siguiente) a esta.
    const centro = (t) => t.camino[Math.floor(t.camino.length / 2)];
    ordenados.forEach((t, i) => {
      if (t.bajo !== null || ordenados.length < 2) return;
      const [desde, hasta] = i > 0 ? [ordenados[i - 1], t] : [t, ordenados[1]];
      const c0 = centro(desde);
      const c1 = centro(hasta);
      const vx = (c1[0] - c0[0]) * M_LAT * Math.cos((c0[1] * Math.PI) / 180);
      const vy = (c1[1] - c0[1]) * M_LAT;
      const [e0, e1] = extremos(t);
      const lx = (e1[0] - e0[0]) * M_LAT * Math.cos((e0[1] * Math.PI) / 180);
      const ly = (e1[1] - e0[1]) * M_LAT;
      const coseno = (vx * lx + vy * ly) / ((Math.hypot(vx, vy) * Math.hypot(lx, ly)) || 1);
      if (Math.abs(coseno) >= 0.5) t.bajo = coseno > 0 ? 0 : 1;
    });
  }

  if (!estimarSentido) return;
  const todas = [...porCalle.values()].flat().filter((t) => ALTURA_MIN(t) < Infinity);
  if (!todas.length) return;
  const medios = todas.map((t) => t.camino[Math.floor(t.camino.length / 2)]);
  const centroPueblo = [medios.reduce((a, p) => a + p[0], 0) / medios.length, medios.reduce((a, p) => a + p[1], 0) / medios.length];
  for (const t of todas) {
    if (t.bajo !== null || ALTURA_MIN(t) < NUMERACION_ALTA) continue;
    const [e0, e1] = extremos(t);
    t.bajo = metros(e0, centroPueblo) <= metros(e1, centroPueblo) ? 0 : 1;
    t.estimado = true;
  }
}

/**
 * @param tramos   [{ nombre, aii, afi, aid, afd, camino: [[lon, lat], ...] }]
 * @param manzanas [{ id, anillos: [[[lon, lat], ...], ...] }]
 */
function construirIndice(tramos, manzanas, { estimarSentido = true } = {}) {
  const porCalle = new Map();
  for (const t of tramos) {
    if (!t.nombre || t.camino.length < 2) continue;
    if (!porCalle.has(t.nombre)) porCalle.set(t.nombre, []);
    porCalle.get(t.nombre).push(t);
  }
  orientar(porCalle, estimarSentido);
  return {
    porCalle,
    nombres: [...porCalle.keys()].map((n) => [n, tokens(n)]),
    manzanas: manzanas.map((m) => ({ ...m, caja: cajaDe(m.anillos) })),
  };
}

/** El tramo de una calle cuyo rango (del lado que corresponde a la paridad) contiene el numero. */
function tramoPara(lista, numero) {
  const par = numero % 2 === 0;
  for (const t of lista) {
    const [x, y] = par ? [t.aid, t.afd] : [t.aii, t.afi];
    if (x > 0 && y > 0 && numero >= Math.min(x, y) && numero <= Math.max(x, y)) return { t, desde: x, hasta: y };
  }
  return null;
}

function manzanaEn(indice, punto) {
  return indice.manzanas.find((m) => punto[0] >= m.caja[0] && punto[0] <= m.caja[2] && punto[1] >= m.caja[1] && punto[1] <= m.caja[3]
    && puntoEnPoligono(punto, m.anillos)) || null;
}

const ESTADOS = {
  ok: 'ubicados en una manzana',
  sin_domicilio: 'sin domicilio, o zona rural',
  sin_numero: 'sin calle y numero (barrio, S/N, otro formato)',
  esquina: 'esquina (dos calles, sin numero)',
  sin_altura: 'tiene calle pero el numero es 0 / sin numero',
  calle_no_encontrada: 'calle no encontrada en el callejero',
  calle_parecida: 'hay una calle parecida (mismo apellido) pero no igual: revisar',
  sin_tramo: 'la calle existe pero ninguna cuadra cubre ese numero',
  calle_ambigua: 'el nombre coincide con mas de una calle',
  sentido_ambiguo: 'no se pudo deducir el sentido de la numeracion',
  sin_manzana: 'el punto no cae en ninguna manzana (borde del pueblo)',
};

// Una casa no esta justo en la esquina de la cuadra: se acota a su parte central, para que el punto no
// caiga en la boca de la calle transversal.
const TRAMO_UTIL = [0.12, 0.88];
// Si a esa distancia del eje no hay manzana (bulevar ancho, vereda profunda), se prueba mas lejos.
const REINTENTOS = [1, 1.4, 2, 3];

/** Resuelve un domicilio. Devuelve siempre { estado, ... }; `clave` agrupa los pendientes. */
function resolver(indice, domicilio, { offsetM = 14, invertirLado = false, reintentar = true, aceptarParecidas = false } = {}) {
  const texto = String(domicilio || '').trim();
  if (!texto || esRural(texto)) return { estado: 'sin_domicilio', clave: texto ? 'zona rural' : '(vacio)' };

  const limpio = limpiar(texto);

  // "LIBERTAD Y AVELLANEDA", "CHACO/MENDOZA": una esquina no es un punto de una cuadra.
  const partes = limpio.split(/\s+Y\s+|\//).map((p) => p.trim()).filter(Boolean);
  if (partes.length >= 2 && partes.every((p) => candidatas(p.replace(/\s+(SN|\d+).*$/, ''), indice.nombres).length)) {
    return { estado: 'esquina', clave: limpio };
  }

  const partido = partirDomicilio(texto);
  if (!partido) return { estado: 'sin_numero', clave: limpio };

  let lista = candidatas(partido.calle, indice.nombres);
  if (!lista.length) {
    const parecidas = candidatas(partido.calle, indice.nombres, true);
    if (!parecidas.length) return { estado: 'calle_no_encontrada', clave: partido.calle };
    if (!aceptarParecidas) return { estado: 'calle_parecida', clave: `${partido.calle}  ->  ${parecidas.map((c) => c.nombre).join(' / ')}` };
    lista = parecidas;
  }
  if (partido.numero === 0) return { estado: 'sin_altura', clave: lista[0].nombre };

  // Entre las calles que podrian ser, solo cuentan las que tienen una cuadra para ese numero.
  const mejor = lista[0].score;
  const conTramo = lista.filter((c) => c.score >= mejor - 1e-9)
    .map((c) => ({ ...c, hallado: tramoPara(indice.porCalle.get(c.nombre), partido.numero) }))
    .filter((c) => c.hallado);
  if (!conTramo.length) return { estado: 'sin_tramo', clave: `${lista[0].nombre} (se pidio el ${partido.numero})` };
  if (new Set(conTramo.map((c) => c.nombre)).size > 1) return { estado: 'calle_ambigua', clave: partido.calle };

  const { nombre, hallado, aproximada } = conTramo[0];
  const rango = `${hallado.desde}-${hallado.hasta}`;
  if (hallado.t.bajo === null || hallado.t.bajo === undefined) return { estado: 'sentido_ambiguo', clave: `${nombre} ${rango}` };

  const camino = hallado.t.bajo === 1 ? [...hallado.t.camino].reverse() : hallado.t.camino; // ahora va de menor a mayor
  const menor = Math.min(hallado.desde, hallado.hasta);
  const mayor = Math.max(hallado.desde, hallado.hasta);
  const f = mayor === menor ? 0.5 : (partido.numero - menor) / (mayor - menor);
  const { punto, ux, uy } = sobreLinea(camino, Math.max(TRAMO_UTIL[0], Math.min(TRAMO_UTIL[1], f)));

  // Al crecer la numeracion, los impares quedan a la izquierda y los pares a la derecha.
  const par = partido.numero % 2 === 0;
  const signo = invertirLado ? -1 : 1;
  const nx = (par ? uy : -uy) * signo;
  const ny = (par ? -ux : ux) * signo;
  const desplazar = (m) => [punto[0] + (nx * m) / (M_LAT * Math.cos((punto[1] * Math.PI) / 180)), punto[1] + (ny * m) / M_LAT];

  let ubicado = null;
  let manzana = null;
  for (const factor of (reintentar ? REINTENTOS : [1])) {
    ubicado = desplazar(offsetM * factor);
    manzana = manzanaEn(indice, ubicado);
    if (manzana) break;
  }
  if (!manzana) return { estado: 'sin_manzana', clave: `${nombre} ${rango}`, lat: ubicado[1], lon: ubicado[0], calle: nombre };
  return {
    estado: 'ok', manzana: manzana.id, lat: ubicado[1], lon: ubicado[0], calle: nombre,
    aproximada: Boolean(aproximada), estimado: Boolean(hallado.t.estimado), buscada: partido.calle,
  };
}

module.exports = {
  M_LAT, quitarAcentos, repararMojibake, tokens, limpiar, partirDomicilio, esRural, candidatas,
  metros, sobreLinea, puntoEnPoligono, cajaDe, construirIndice, resolver, ESTADOS, ALTURA_MIN, NUMERACION_ALTA,
};
