// TEA Portal API - FunnelUp Bridge
// Vercel Serverless Function

const FUNNELUP_API = 'https://services.leadconnectorhq.com';
const LOCATION_ID  = '9cXtL7yJiTR3U0C2xmDt';
const API_KEY      = process.env.FUNNELUP_API_KEY;

const PROFESORES = [
  { nombre: 'Daniela Guzman',     userId: '8nZnZoJ4THtn2KwuFiqD', email: 'gladismarguzman@gmail.com'       },
  { nombre: 'David Gonzalez',     userId: 'ruaficj9PgvxfYsy0NfX', email: 'davidsecundaria20@gmail.com'     },
  { nombre: 'Isabella Rodríguez', userId: 'M6PmhYh3fqrFjcxyfdj5', email: 'isabellarodriguez.am@gmail.com' },
  { nombre: 'Jeffry Ferrer',      userId: 'agZ9APmwt6J62RoEdUcX', email: 'ferrerjeffry9@gmail.com'        },
  { nombre: 'Militza Castañeda',  userId: 'ufSR1xGQmBXgON6vMSRT', email: 'milidelvalle2000@gmail.com'     },
  { nombre: 'Nathaly Regardiz',   userId: 'DPeRW5cYIErHZ6AXOmf7', email: 'janathaly16@gmail.com'          },
];

// Contadores iniciales basados en estudiantes actuales
// Se actualizan en el contacto del profesor como custom fields
// tea_alumnos_manana / tea_alumnos_tarde / tea_alumnos_noche
const ALUMNOS_INICIALES = {
  'gladismarguzman@gmail.com':      { manana: 0, tarde: 1, noche: 2 },
  'davidsecundaria20@gmail.com':    { manana: 0, tarde: 0, noche: 0 },
  'isabellarodriguez.am@gmail.com': { manana: 0, tarde: 0, noche: 0 },
  'ferrerjeffry9@gmail.com':        { manana: 0, tarde: 2, noche: 1 },
  'milidelvalle2000@gmail.com':     { manana: 0, tarde: 0, noche: 3 },
  'janathaly16@gmail.com':          { manana: 0, tarde: 0, noche: 0 },
};

const MAX_ALUMNOS_POR_BLOQUE = 3;

const BLOQUES = {
  manana: { inicio: 8,  fin: 11 },
  tarde:  { inicio: 13, fin: 16 },
  noche:  { inicio: 17, fin: 21 },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function headers(extra = {}) {
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type':  'application/json',
    'Version':       '2021-07-28',
    ...extra,
  };
}

async function funnelup(path, opts = {}) {
  const res = await fetch(`${FUNNELUP_API}${path}`, {
    ...opts,
    headers: headers(opts.headers || {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FunnelUp ${res.status}: ${txt}`);
  }
  return res.json();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function send(res, status, data) {
  cors(res);
  res.status(status).json(data);
}

function parseHora(horaStr) {
  const [time, meridiem] = horaStr.trim().split(' ');
  let [h, m] = time.split(':').map(Number);
  if (meridiem === 'PM' && h !== 12) h += 12;
  if (meridiem === 'AM' && h === 12) h = 0;
  return h + (m / 60);
}

function horaABloque(horaNum) {
  if (horaNum >= 8  && horaNum < 11) return 'manana';
  if (horaNum >= 13 && horaNum < 16) return 'tarde';
  if (horaNum >= 17 && horaNum < 21) return 'noche';
  return null;
}

// Verifica si el profesor tiene cualquier evento en la hora dada
// Si hay cualquier evento → ocupado → no aparece
async function profesorLibreEnHora(userId, horaStr, fechaISO) {
  try {
    const fechaObj = new Date(fechaISO);
    const start    = new Date(fechaObj); start.setHours(0, 0, 0, 0);
    const end      = new Date(fechaObj); end.setHours(23, 59, 59, 999);

    const data    = await funnelup(`/calendars/blocked-slots?locationId=${LOCATION_ID}&userId=${userId}&startTime=${start.getTime()}&endTime=${end.getTime()}`);
    const eventos = data?.events || [];
    const horaNum = parseHora(horaStr);
    const slotFin = horaNum + 0.75; // 45 minutos

    const ocupado = eventos.some(ev => {
      const evStart = new Date(ev.startTime);
      const evEnd   = new Date(ev.endTime);
      const evH     = evStart.getHours() + evStart.getMinutes() / 60;
      const evHFin  = evEnd.getHours()   + evEnd.getMinutes()   / 60;
      return evH < slotFin && evHFin > horaNum;
    });

    return !ocupado;
  } catch (e) {
    console.error(`Error blocked-slots ${userId}:`, e.message);
    return true;
  }
}

// Lee el contador de alumnos del custom field del contacto del profesor
// Si no existe el campo aún, usa el valor inicial hardcodeado
async function leerAlumnosEnBloque(contacto, email, bloque) {
  const campoKey = `tea_alumnos_${bloque}`;
  const campoVal = contacto?.customFields?.find(f => f.key === campoKey)?.value;

  if (campoVal !== undefined && campoVal !== null && campoVal !== '') {
    return parseInt(campoVal, 10) || 0;
  }

  // Fallback a valor inicial si el campo aún no existe en FunnelUp
  return ALUMNOS_INICIALES[email]?.[bloque] ?? 0;
}

// ─── router ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    switch (action) {

      // ── 1. LOGIN ─────────────────────────────────────────────────────────
      case 'login': {
        const { email, password } = req.body || {};
        if (!email) return send(res, 400, { ok: false, error: 'Email requerido' });

        const data    = await funnelup(`/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(email)}`);
        const contact = data?.contact;
        if (!contact) return send(res, 401, { ok: false, error: 'NO_STUDENT' });

        const tags = (contact.tags || []).map(t => t.toLowerCase());
        if (!tags.includes('tea-student')) return send(res, 401, { ok: false, error: 'NO_TAG' });

        const storedPass = contact.customFields?.find(f => f.key === 'tea_password')?.value;
        const phone      = (contact.phone || '').replace(/\D/g, '').slice(-4);
        const validPass  = storedPass ? storedPass === password : phone === password;
        if (!validPass) return send(res, 401, { ok: false, error: 'WRONG_PASS' });

        const yaAsignado = contact.customFields?.find(f => f.key === 'tea_horario_asignado')?.value;

        return send(res, 200, {
          ok: true,
          student: {
            id:         contact.id,
            nombre:     `${contact.firstName} ${contact.lastName}`.trim(),
            email:      contact.email,
            yaAsignado: !!yaAsignado,
            bloque:     contact.customFields?.find(f => f.key === 'tea_bloque')?.value || '',
            hora:       contact.customFields?.find(f => f.key === 'tea_hora')?.value || '',
            profesor:   contact.customFields?.find(f => f.key === 'tea_profesor_asignado')?.value || '',
          },
        });
      }

      // ── 2. PROFESORES disponibles para hora y fecha específicas ──────────
      case 'profesores': {
        const { hora, fecha } = req.query;
        if (!hora || !fecha) return send(res, 400, { ok: false, error: 'hora y fecha requeridos' });

        const horaNum = parseHora(hora);
        const bloque  = horaABloque(horaNum);
        if (!bloque) return send(res, 400, { ok: false, error: 'Hora fuera de bloques disponibles' });

        const disponibles = [];

        await Promise.all(PROFESORES.map(async (prof) => {
          try {
            const [contactData, libre] = await Promise.all([
              funnelup(`/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(prof.email)}`),
              profesorLibreEnHora(prof.userId, hora, fecha),
            ]);

            if (!libre) return; // tiene evento en esa hora → no disponible

            const contacto       = contactData?.contact;
            const alumnosActuales = await leerAlumnosEnBloque(contacto, prof.email, bloque);

            if (alumnosActuales >= MAX_ALUMNOS_POR_BLOQUE) return; // bloque lleno

            disponibles.push({
              id:               contacto?.id || prof.userId,
              userId:           prof.userId,
              nombre:           prof.nombre,
              bio:              contacto?.customFields?.find(f => f.key === 'tea_bio')?.value || '',
              videoUrl:         contacto?.customFields?.find(f => f.key === 'tea_video_url')?.value || '',
              cuposDisponibles: MAX_ALUMNOS_POR_BLOQUE - alumnosActuales,
              bloque,
            });
          } catch (e) {
            console.error(`Error profesor ${prof.nombre}:`, e.message);
          }
        }));

        return send(res, 200, { ok: true, profesores: disponibles });
      }

      // ── 3. CONFIRMAR asignación ──────────────────────────────────────────
      case 'asignar': {
        const { studentId, profesorContactoId, profesorUserId, profesorNombre, profesorEmail, bloque, hora } = req.body || {};
        if (!studentId || !profesorContactoId || !bloque || !hora) {
          return send(res, 400, { ok: false, error: 'Datos incompletos' });
        }

        // 1. Actualizar contacto del estudiante
        const horarioStr = JSON.stringify({ bloque, hora, profesor: profesorNombre, profesorId: profesorContactoId });
        await funnelup(`/contacts/${studentId}`, {
          method: 'PUT',
          body: JSON.stringify({
            customFields: [
              { key: 'tea_horario_asignado',  field_value: horarioStr     },
              { key: 'tea_profesor_asignado', field_value: profesorNombre },
              { key: 'tea_bloque',            field_value: bloque         },
              { key: 'tea_hora',              field_value: hora           },
            ],
          }),
        });

        // 2. Asignar profesor como responsable del contacto
        if (profesorUserId) {
          await funnelup(`/contacts/${studentId}`, {
            method: 'PUT',
            body: JSON.stringify({ assignedTo: profesorUserId }),
          });
        }

        // 3. Incrementar contador de alumnos del profesor en ese bloque
        if (profesorContactoId && bloque) {
          const profData   = await funnelup(`/contacts/${profesorContactoId}`);
          const profContact = profData?.contact;
          const campoKey   = `tea_alumnos_${bloque}`;
          const actual     = await leerAlumnosEnBloque(profContact, profesorEmail || '', bloque);

          await funnelup(`/contacts/${profesorContactoId}`, {
            method: 'PUT',
            body: JSON.stringify({
              customFields: [
                { key: campoKey, field_value: String(actual + 1) },
              ],
            }),
          });
        }

        return send(res, 200, { ok: true, mensaje: 'Asignación completada' });
      }

      // ── 4. DASHBOARD ─────────────────────────────────────────────────────
      case 'dashboard': {
        const { studentId } = req.query;
        if (!studentId) return send(res, 400, { ok: false, error: 'studentId requerido' });

        const data    = await funnelup(`/contacts/${studentId}`);
        const contact = data?.contact;
        if (!contact) return send(res, 404, { ok: false, error: 'Estudiante no encontrado' });

        const cf = (key) => contact.customFields?.find(f => f.key === key)?.value || '';

        return send(res, 200, {
          ok: true,
          student: {
            nombre:   `${contact.firstName} ${contact.lastName}`.trim(),
            email:    contact.email,
            bloque:   cf('tea_bloque'),
            hora:     cf('tea_hora'),
            profesor: cf('tea_profesor_asignado'),
          },
        });
      }

      // ── 5. DEBUG ─────────────────────────────────────────────────────────
      case 'debug_calendario': {
        const { userId, fecha } = req.query;
        if (!userId || !fecha) return send(res, 400, { ok: false, error: 'userId y fecha requeridos' });

        const fechaObj = new Date(fecha);
        const start    = new Date(fechaObj); start.setHours(0,0,0,0);
        const end      = new Date(fechaObj); end.setHours(23,59,59,999);

        const data = await funnelup(`/calendars/blocked-slots?locationId=${LOCATION_ID}&userId=${userId}&startTime=${start.getTime()}&endTime=${end.getTime()}`);
        return send(res, 200, { ok: true, raw: data });
      }

      default:
        return send(res, 400, { ok: false, error: 'Acción no reconocida' });
    }
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: err.message });
  }
};