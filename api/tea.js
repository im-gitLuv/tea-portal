// TEA Portal API - FunnelUp Bridge
const FUNNELUP_API = 'https://services.leadconnectorhq.com';
const LOCATION_ID  = '9cXtL7yJiTR3U0C2xmDt';
const API_KEY      = process.env.FUNNELUP_API_KEY;

const PROFESORES = [
  { nombre: 'Daniela Guzman',     userId: '8nZnZoJ4THtn2KwuFiqD', email: 'gladismarguzman@gmail.com'       },
  { nombre: 'David Gonzalez',     userId: 'ruaficj9PgvxfYsy0NfX', email: 'davidsecundaria20@gmail.com'     },
  { nombre: 'Isabella Rodríguez', userId: 'M6PmhYh3fqrFjcxyfdj5', email: 'isabellarodriguez.am@gmail.com' },
  { nombre: 'Jeffry Ferrer',      userId: 'agZ9APmwt6J62RoEdUcX', email: 'ferrerjeffry9@gmail.com'        },
  { nombre: 'Militza Castañeda',  userId: 'ufSR1xGQmBXgON6vMSRT', email: 'milidelvalle2000@gmail.com'     },
];

const ALUMNOS_INICIALES = {
  'gladismarguzman@gmail.com':      { manana: 0, tarde: 2, noche: 3 },
  'davidsecundaria20@gmail.com':    { manana: 0, tarde: 0, noche: 0 },
  'isabellarodriguez.am@gmail.com': { manana: 2, tarde: 0, noche: 0 },
  'ferrerjeffry9@gmail.com':        { manana: 3, tarde: 3, noche: 2 },
  'milidelvalle2000@gmail.com':     { manana: 3, tarde: 3, noche: 3 },
};

const MAX_ALUMNOS_POR_BLOQUE = 3;
const BLOQUES = {
  manana: { inicio: 8,  fin: 11 },
  tarde:  { inicio: 13, fin: 16 },
  noche:  { inicio: 17, fin: 21 },
};

// IDs reales de los custom fields en FunnelUp (obtenidos via API)
const FIELD_IDS = {
  tea_horario_asignado:  'D21J2OhL2lbShnJUFCqm',
  tea_bloque:            'KoZo29futqnIujB4igX3',
  tea_profesor_asignado: 'bM4AbwxNURruK2Ztza3W',
  tea_hora:              'khp9riWSgCna58A6O4pd',
  teacher_id:            'lqmCt3gqk1UMheYDbG7A',
  tea_fecha_inicio:      '1YAuS54toIr124DvkjOY',
};

// Leer custom field por ID real
function cf(contact, nombre) {
  const fieldId = FIELD_IDS[nombre];
  if (!fieldId) return '';
  return contact?.customFields?.find(f => f.id === fieldId)?.value || '';
}

// ─── helpers ────────────────────────────────────────────────────────────────

function headers(extra = {}) {
  return { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'Version': '2021-07-28', ...extra };
}

async function funnelup(path, opts = {}) {
  const res = await fetch(`${FUNNELUP_API}${path}`, { ...opts, headers: headers(opts.headers || {}) });
  if (!res.ok) { const txt = await res.text(); throw new Error(`FunnelUp ${res.status}: ${txt}`); }
  return res.json();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function send(res, status, data) { cors(res); res.status(status).json(data); }

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

async function profesorLibreEnHora(userId, horaStr, fechaISO) {
  try {
    const fechaObj = new Date(fechaISO);
    const start = new Date(fechaObj); start.setHours(0,0,0,0);
    const end   = new Date(fechaObj); end.setHours(23,59,59,999);
    const data  = await funnelup(`/calendars/blocked-slots?locationId=${LOCATION_ID}&userId=${userId}&startTime=${start.getTime()}&endTime=${end.getTime()}`);
    const eventos = data?.events || [];
    const horaNum = parseHora(horaStr);
    const slotFin = horaNum + 0.75;
    const ocupado = eventos.some(ev => {
      const evH    = new Date(ev.startTime).getHours() + new Date(ev.startTime).getMinutes() / 60;
      const evHFin = new Date(ev.endTime).getHours()   + new Date(ev.endTime).getMinutes()   / 60;
      return evH < slotFin && evHFin > horaNum;
    });
    return !ocupado;
  } catch(e) { console.error(`blocked-slots ${userId}:`, e.message); return true; }
}

function leerAlumnosEnBloque(contacto, email, bloque) {
  const campoKey = `tea_alumnos_${bloque}`;
  // Para profesores usamos key (endpoint search/duplicate sí devuelve key)
  const campoVal = contacto?.customFields?.find(f => f.key === campoKey)?.value;
  if (campoVal !== undefined && campoVal !== null && campoVal !== '') return parseInt(campoVal, 10) || 0;
  return ALUMNOS_INICIALES[email]?.[bloque] ?? 0;
}

function calcularProgreso(fechaInicio) {
  if (!fechaInicio) return { semana: 1, fase: 1 };
  const inicio = new Date(fechaInicio);
  if (isNaN(inicio)) return { semana: 1, fase: 1 };
  const hoy    = new Date();
  const dias   = Math.floor((hoy - inicio) / (1000 * 60 * 60 * 24));
  const semana = Math.max(1, Math.min(26, Math.floor(dias / 7) + 1));
  let fase = 1;
  if      (semana <= 6)  fase = 1;
  else if (semana <= 16) fase = 2;
  else if (semana <= 22) fase = 3;
  else                   fase = 4;
  return { semana, fase };
}

// ─── router ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action } = req.query;

  try {
    switch (action) {

      // ── LOGIN ────────────────────────────────────────────────────────────
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

        // login usa search/duplicate que devuelve keys — OK
        const cfKey      = (key) => contact.customFields?.find(f => f.key === key)?.value || '';
        const yaAsignado = cfKey('tea_horario_asignado');
        const { semana, fase } = calcularProgreso(cfKey('tea_fecha_inicio'));

        return send(res, 200, {
          ok: true,
          student: {
            id:         contact.id,
            nombre:     `${contact.firstName} ${contact.lastName}`.trim(),
            email:      contact.email,
            phone:      contact.phone || '',
            yaAsignado: !!yaAsignado,
            bloque:     cfKey('tea_bloque'),
            hora:       cfKey('tea_hora'),
            profesor:   cfKey('tea_profesor_asignado'),
            teacherId:  cfKey('teacher_id'),
            semana,
            fase,
          },
        });
      }

      // ── PROFESORES ───────────────────────────────────────────────────────
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
            if (!libre) return;

            const contacto        = contactData?.contact;
            const alumnosActuales = leerAlumnosEnBloque(contacto, prof.email, bloque);
            if (alumnosActuales >= MAX_ALUMNOS_POR_BLOQUE) return;

            const telefono = (contacto?.phone || '').replace(/\D/g, '');

            disponibles.push({
              id:               contacto?.id || prof.userId,
              userId:           prof.userId,
              nombre:           prof.nombre,
              bio:              contacto?.customFields?.find(f => f.key === 'tea_bio')?.value || '',
              videoUrl:         contacto?.customFields?.find(f => f.key === 'tea_video_url')?.value || '',
              telefono,
              cuposDisponibles: MAX_ALUMNOS_POR_BLOQUE - alumnosActuales,
              bloque,
            });
          } catch(e) { console.error(`Prof ${prof.nombre}:`, e.message); }
        }));

        return send(res, 200, { ok: true, profesores: disponibles });
      }

      // ── ASIGNAR ──────────────────────────────────────────────────────────
      case 'asignar': {
        const { studentId, profesorContactoId, profesorUserId, profesorNombre, profesorEmail, bloque, hora } = req.body || {};
        if (!studentId || !profesorContactoId || !bloque || !hora) {
          return send(res, 400, { ok: false, error: 'Datos incompletos' });
        }

        const horarioStr = JSON.stringify({ bloque, hora, profesor: profesorNombre, profesorId: profesorContactoId });
        const hoy        = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        await funnelup(`/contacts/${studentId}`, {
          method: 'PUT',
          body: JSON.stringify({
            customFields: [
              { key: 'tea_horario_asignado',  field_value: horarioStr     },
              { key: 'tea_profesor_asignado', field_value: profesorNombre },
              { key: 'tea_bloque',            field_value: bloque         },
              { key: 'tea_hora',              field_value: hora           },
              { key: 'teacher_id',            field_value: profesorUserId },
              { key: 'tea_fecha_inicio',      field_value: hoy            },
            ],
          }),
        });

        if (profesorUserId) {
          await funnelup(`/contacts/${studentId}`, {
            method: 'PUT',
            body: JSON.stringify({ assignedTo: profesorUserId }),
          });
        }

        if (profesorContactoId && bloque) {
          try {
            const profData    = await funnelup(`/contacts/${profesorContactoId}`);
            const profContact = profData?.contact;
            if (profContact) {
              const campoKey = `tea_alumnos_${bloque}`;
              const actual   = leerAlumnosEnBloque(profContact, profesorEmail || '', bloque);
              await funnelup(`/contacts/${profesorContactoId}`, {
                method: 'PUT',
                body: JSON.stringify({
                  customFields: [{ key: campoKey, field_value: String(actual + 1) }],
                }),
              });
            }
          } catch(e) { console.error('Error contador:', e.message); }
        }

        return send(res, 200, { ok: true, mensaje: 'Asignación completada' });
      }

      // ── DASHBOARD ────────────────────────────────────────────────────────
      case 'dashboard': {
        const { studentId } = req.query;
        if (!studentId) return send(res, 400, { ok: false, error: 'studentId requerido' });

        const data    = await funnelup(`/contacts/${studentId}`);
        const contact = data?.contact;
        if (!contact) return send(res, 404, { ok: false, error: 'Estudiante no encontrado' });

        // Este endpoint devuelve IDs en lugar de keys — usamos FIELD_IDS
        const cfId = (nombre) => cf(contact, nombre);
        const { semana, fase } = calcularProgreso(cfId('tea_fecha_inicio'));

        // Teléfono del profesor
        let profesorTelefono = '';
        const teacherId = cfId('teacher_id');
        if (teacherId) {
          try {
            const profMatch = PROFESORES.find(p => p.userId === teacherId);
            if (profMatch) {
              const profData = await funnelup(`/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(profMatch.email)}`);
              profesorTelefono = (profData?.contact?.phone || '').replace(/\D/g, '');
            }
          } catch(e) { console.error('Error prof phone:', e.message); }
        }

        return send(res, 200, {
          ok: true,
          student: {
            nombre:           `${contact.firstName} ${contact.lastName}`.trim(),
            email:            contact.email,
            bloque:           cfId('tea_bloque'),
            hora:             cfId('tea_hora'),
            profesor:         cfId('tea_profesor_asignado'),
            teacherId,
            profesorTelefono,
            semana,
            fase,
          },
        });
      }

      // ── DEBUG ────────────────────────────────────────────────────────────
      case 'debug_calendario': {
        const { userId, fecha } = req.query;
        if (!userId || !fecha) return send(res, 400, { ok: false, error: 'userId y fecha requeridos' });
        const fechaObj = new Date(fecha);
        const start = new Date(fechaObj); start.setHours(0,0,0,0);
        const end   = new Date(fechaObj); end.setHours(23,59,59,999);
        const data  = await funnelup(`/calendars/blocked-slots?locationId=${LOCATION_ID}&userId=${userId}&startTime=${start.getTime()}&endTime=${end.getTime()}`);
        return send(res, 200, { ok: true, raw: data });
      }

      case 'debug_contacto': {
        const { studentId } = req.query;
        if (!studentId) return send(res, 400, { ok: false, error: 'studentId requerido' });
        const data = await funnelup(`/contacts/${studentId}`);
        return send(res, 200, { ok: true, raw: data });
      }

      default:
        return send(res, 400, { ok: false, error: 'Acción no reconocida' });
    }
  } catch(err) {
    console.error(err);
    return send(res, 500, { ok: false, error: err.message });
  }
};