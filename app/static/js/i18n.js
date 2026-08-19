const es = {
  app: {
    name: 'MiniCPM',
    tagline: 'Asistente de IA local',
  },
  nav: {
    chat: 'Conversación',
    kb: 'Fuente de conocimientos',
    mail: 'Correo',
    services: 'Servicios',
  },
  skip: 'Saltar al contenido principal',

  // Vocabulario genérico reutilizable (chrome de UI). Las cajas de comunicación
  // (session.chat, kb.query, mail.compose) mantienen sus propias acciones.
  common: {
    loading: 'Cargando…',
    empty: 'Sin contenido',
    close: 'Cerrar',
    ok: 'Aceptar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    retry: 'Reintentar',
  },

  // Vocabulario canónico de estados (servicios, documentos, procesos).
  status: {
    running: 'Activo',
    starting: 'Iniciando',
    ready: 'Listo',
    stopped: 'Detenido',
    error: 'Error',
  },

  // Identidad del modelo cargado: estado global, definido en capas.
  // Los valores concretos (p. ej. "MiniCPM5-1B", "Q4_K_M") vienen de la
  // configuración del modelo, no del diccionario i18n.
  model: {
    label: 'Modelo',
    reference: 'Referencia',
    quantization: 'Cuantización',
  },

  gpu: {
    label: 'GPU',
    unavailable: 'GPU no disponible',
    warnLimit: 'Sobreesfuerzo',
    used: '{used} / {total} MiB',
    util: '{pct}%',
  },

  // Vocabulario del panel de conversación (módulo mc-chat). Convive con
  // "session" (capa anterior); aquí se mantienen las claves planas de chat.
  chat: {
    title: 'Conversación',
    placeholder: 'Escribe un mensaje…',
    send: 'Enviar',
    stop: 'Detener',
    think: 'Razonamiento',
    modelLabel: 'Modelo',
    newSession: 'Nueva conversación',
    sessions: 'Conversaciones',
    deleteSession: 'Eliminar conversación',
    confirmDeleteTitle: 'Eliminar conversación',
    confirmDeleteBody: '¿Eliminar "{name}" y sus {n} mensajes?',
    streaming: 'Generando…',
    empty: '(sin respuesta)',
    noSession: 'Selecciona o crea una conversación para empezar.',
    errorPrefix: 'Error en el chat',
    notRunning: 'El modelo {model} no está en ejecución.',
    goServices: 'Ir a Servicios',
  },

  // "session" = contenedor local: título, ciclo de vida, listado, salida/estado.
  // "session.chat" = caja de comunicación con el endpoint del LLM; sus claves
  // reflejan los campos del payload (messages, stream, stop, enable_thinking).
  session: {
    title: 'Conversación',
    label: 'Sesión',
    list: 'Sesiones',
    new: 'Nueva sesión',
    delete: 'Eliminar sesión',
    confirmDeleteTitle: 'Eliminar sesión',
    confirmDeleteBody: '¿Eliminar "{name}" y sus {n} mensajes?',
    empty: '(vacío)',
    none: 'Selecciona o crea una sesión para empezar.',
    streaming: 'Generando…',
    cancelled: '(cancelado)',
    errorPrefix: 'Error en la conversación',
    notRunning: 'El modelo {model} no está en ejecución.',
    goServices: 'Ir a Servicios',
    chat: {
      placeholder: 'Escribe un mensaje…',
      send: 'Enviar',
      stop: 'Detener',
      thinking: 'Razonamiento',
      thinkingOff: 'Sin razonamiento',
      thinkingUnavailable: 'El razonamiento no está disponible con el modelo actual.',
    },
  },

  // "kb" = gestión local de documentos; "kb.query" = caja de comunicación con
  // el endpoint de recuperación (búsqueda y respuesta).
  kb: {
    title: 'Fuente de conocimientos',
    upload: 'Subir documentos',
    uploading: 'Subiendo…',
    indexing: 'Indexando…',
    uploadHint: 'TXT, MD, JSON, PDF, DOCX, HTML',
    empty: 'La fuente de conocimientos está vacía.',
    noDocuments: 'No hay documentos todavía.',
    docCount: '{n} documentos',
    chunks: '{n} fragmentos',
    duplicate: 'Duplicado: {name}',
    limit: 'Límite de documentos alcanzado',
    ready: 'Listo',
    error: 'Error',
    search: 'Buscar',
    answer: 'Responder',
    searchPlaceholder: 'Buscar en tus documentos…',
    queryPlaceholder: 'Pregunta sobre tus documentos…',
    noResults: 'Sin resultados',
    noContext: 'No hay contexto suficiente',
    deleteDoc: 'Documento eliminado',
    delete: 'Eliminar documento',
    confirmDeleteTitle: 'Eliminar documento',
    confirmDeleteBody: '¿Eliminar "{name}" de la fuente de conocimientos?',
    query: {
      search: 'Buscar',
      ask: 'Preguntar',
      searchPlaceholder: 'Buscar en tus documentos…',
      askPlaceholder: 'Pregunta sobre tus documentos…',
      noResults: 'Sin resultados',
      noContext: 'No hay contexto suficiente',
      rerankOff: 'Reranker no disponible',
      reranked: 'Resultados reordenados por el reranker',
      forcedModel: 'Respondido con el modelo {model}',
    },
  },

  // "mail" = buzón y estado local; "mail.compose" = caja de composición cuyos
  // campos se serializan en el mensaje saliente (To, Subject, Body, Adjuntos).
  mail: {
    title: 'Correo',
    connectorDown: 'El conector de correo no está disponible',
    bridgeDown: 'El puente de correo no está disponible',
    retry: 'Reintentar',
    configure: 'Configurar cuenta',
    user: 'Usuario',
    password: 'Contraseña',
    login: 'Conectar',
    folders: 'Carpetas',
    inbox: 'Recibidos',
    unread: 'no leídos',
    noMessages: 'No hay mensajes.',
    emptySubject: '(sin asunto)',
    newMessage: 'Mensaje',
    markRead: 'Marcar como leído',
    markUnread: 'Marcar como no leído',
    reply: 'Responder',
    replyAll: 'Responder a todos',
    refresh: 'Actualizar',
    searchPlaceholder: 'Buscar correo…',
    compose: {
      open: 'Redactar',
      title: 'Nuevo mensaje',
      to: 'Para',
      subject: 'Asunto',
      body: 'Mensaje',
      attachments: 'Adjuntos',
      send: 'Enviar',
      sending: 'Enviando…',
      sent: 'Enviado a {to}',
      discardTitle: 'Descartar borrador',
      discardBody: '¿Descartar el borrador?',
    },
  },

  // Panel de servicios: los estados usan status.*, la GPU gpu.label y el
  // modelo model.* (sin duplicados locales).
  services: {
    title: 'Servicios',
    start: 'Iniciar',
    stop: 'Detener',
    logs: 'Registros',
    logEmpty: 'Sin registros todavía.',
    noServices: 'Sin servicios disponibles.',
    slot: 'Modelo activo',
    slotNone: 'ninguno',
    slotDisabled: 'No disponible',
    load: 'Carga',
    tokens: 'tok/s',
    tokensPerSec: '{n} tok/s',
    uptime: 'en marcha',
    contextWindow: 'Ventana de contexto',
    confirmStopTitle: 'Detener servicio',
    confirmStopBody: '¿Detener este servicio?',
  },

  toast: {
    default: 'Notificación',
  },
};

const dict = { es };

export const i18n = dict.es;

export function t(key, vars = {}) {
  const value = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), i18n);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}