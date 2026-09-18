/**
 * Traducción de los nombres de icono del frontend a los de Lucide.
 *
 * El markup se escribió contra Font Awesome 5 (`fa-save`, `fa-times`, `fa-users-cog`) y
 * se mantiene tal cual: cambiar 181 usos repartidos en HTML y en plantillas de JS sería
 * un diff enorme y sin ganancia. Acá se dice qué dibujo de Lucide le corresponde a cada
 * nombre, y `build-assets.js` genera las máscaras con eso.
 *
 * Lucide no es un reemplazo uno a uno de Font Awesome: tiene menos iconos y otra lógica
 * de nombres. Donde no hay equivalente exacto se eligió el más cercano en significado,
 * no en forma — está anotado en cada caso que no es obvio.
 *
 * Para agregar un icono: usalo en `public/` con el nombre que quieras, agregalo acá
 * apuntando a un archivo de `node_modules/lucide-static/icons/`, y corré el build. Si
 * falta, el build falla en vez de dejar un hueco invisible en la página.
 */

module.exports = {
  // —— Navegación y flechas ——
  'arrow-left': 'arrow-left',
  'arrow-up': 'arrow-up',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  'caret-down': 'chevron-down',
  'sort': 'chevrons-up-down',
  'sort-up': 'chevron-up',
  'sort-down': 'chevron-down',
  'home': 'house',
  'sign-in-alt': 'log-in',
  'sign-out-alt': 'log-out',
  'redo': 'rotate-cw',
  'sync': 'refresh-cw',

  // —— Personas y roles ——
  'user': 'user',
  'user-circle': 'circle-user',
  'user-check': 'user-check',
  'user-edit': 'user-pen',
  'user-plus': 'user-plus',
  'user-shield': 'shield-check',
  'user-slash': 'user-x',
  'users': 'users',
  'users-slash': 'user-round-x',
  // En Font Awesome eran el icono de "administrar usuarios"; Lucide lo resuelve con
  // el engranaje aparte, así que se usa el de ajustes sobre personas.
  'users-cog': 'user-cog',
  'users-gear': 'user-cog',

  // —— Padrón y relevamiento ——
  'id-card': 'id-card',
  // Lucide no tiene el símbolo de géneros. Este rotula la columna y el filtro "Sexo",
  // así que va una figura humana y no `users`, que se confundiría con el módulo Usuarios.
  'venus-mars': 'person-standing',
  'vote-yea': 'vote',
  'poll': 'chart-column',
  'flag': 'flag',
  'star': 'star',
  'trophy': 'trophy',
  'fingerprint': 'fingerprint',
  // "Fallecido": Lucide no tiene una cruz cristiana. `cross` es la cruz médica, que es
  // lo más cercano disponible y se lee igual en contexto.
  'cross': 'cross',
  'hands-helping': 'handshake',
  'hand-holding-heart': 'heart-handshake',
  'hand-pointer': 'pointer',
  'building': 'building-2',
  'map-marker-alt': 'map-pin',
  'map-signs': 'signpost',

  // —— Gráficos y datos ——
  'chart-bar': 'chart-column',
  'chart-line': 'chart-line',
  'chart-pie': 'chart-pie',
  'tachometer-alt': 'gauge',
  'list': 'list',
  'clipboard-list': 'clipboard-list',
  'clipboard-check': 'clipboard-check',

  // —— Archivos y transferencias ——
  'file-alt': 'file-text',
  'file-code': 'file-code',
  'file-csv': 'file-spreadsheet',
  'file-export': 'file-output',
  'download': 'download',
  'cloud-upload-alt': 'cloud-upload',
  'save': 'save',

  // —— Acciones ——
  'edit': 'square-pen',
  'pen': 'pen-line',
  'trash': 'trash-2',
  'search': 'search',
  'filter': 'filter',
  'plus-circle': 'circle-plus',
  'times': 'x',
  'times-circle': 'circle-x',
  'check-circle': 'circle-check',
  'eye': 'eye',
  'eye-slash': 'eye-off',
  'key': 'key-round',
  'lock': 'lock',

  // —— Estado y avisos ——
  'info-circle': 'info',
  'question-circle': 'circle-help',
  'exclamation-circle': 'circle-alert',
  'exclamation-triangle': 'triangle-alert',
  'circle': 'circle',
  'clock': 'clock',
  'hourglass-half': 'hourglass',
  'calendar-alt': 'calendar',
  'comment': 'message-square',
  // El spinner gira por CSS (`.fa-spin`), así que alcanza con un aro partido.
  'spinner': 'loader-circle',

  // —— Interfaz ——
  'desktop': 'monitor',
  'moon': 'moon',
  'sun': 'sun',
};
