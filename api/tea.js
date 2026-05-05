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

async function profesorLibreEnHora(userId, horaStr, fechaISO) {
  try {
    const fecha    = new Date(fechaISO);
    const startDay = new Date(fecha); startDay.setHours(0, 0, 0, 0);
    const endDay   = new Date(fecha); endDay.setHours(23, 59, 59, 999);

    const data    = await funnelup(`/calendars/events?locationId=${LOCATION_ID}&userId=${userId}&startTime=${startDay.getTime()}&endTime=${endDay.getTime()}`);
    const eventos = data?.events || data?.data || [];
    const horaNum = parseHora(horaStr);

    const ocupado = eventos.some(ev => {
      const evStart = new Date(ev.startTime).getHours() + new Date(ev.startTime).getMinutes() / 60;
      const evEnd   = new Date(ev.endTime).getHours()   + new Date(ev.endTime).getMinutes()   / 60;
      return evStart < (horaNum + 0.75) && evEnd > horaNum;
    });

    return !ocupado;
  } catch (e) {
    console.error(`Error calendario ${userId}:`, e.message);
    return true;
  }
}

async function contarAlumnosTEA(userId, bloque) {
  try {
    const bloqueDef = BLOQUES[bloque];
    if (!bloqueDef) return 0;

    const hoy    = new Date();
    const lunes  = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);
    const viernes = new Date(lunes);
    viernes.setDate(lunes.getDate() + 4);
    viernes.setHours(23, 59, 59, 999);

    const data    = await funnelup(`/calendars/events?locationId=${LOCATION_ID}&userId=${userId}&startTime=${lunes.getTime()}&endTime=${viernes.getTime()}`);
    const eventos = data?.events || data?.data || [];

    const conteosPorHora = {};
    eventos.forEach(ev => {
      const evStart = new Date(ev.startTime);
      const horaEv  = evStart.getHours();
      if (horaEv >= bloqueDef.inicio && horaEv < bloqueDef.fin) {
        const key = `${evStart.toDateString()}-${horaEv}`;
        conteosPorHora[key] = (conteosPorHora[key] || 0) + 1;
      }
    });

    return Math.max(0, ...Object.values(conteosPorHora), 0);
  } catch (e) {
    console.error(`Error contando alumnos ${userId}:`, e.message);
    return 0;
  }
}

// ─── router ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    switch (action) {

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

      case 'profesores': {
        const { hora, fecha } = req.query;
        if (!hora || !fecha) return send(res, 400, { ok: false, error: 'hora y fecha requeridos' });

        const horaNum = parseHora(hora);
        let bloque = 'manana';
        if (horaNum >= 13 && horaNum < 17) bloque = 'tarde';
        else if (horaNum >= 17) bloque = 'noche';

        const disponibles = [];

        await Promise.all(PROFESORES.map(async (prof) => {
          try {
            const [contactData, libre, alumnosActuales] = await Promise.all([
              funnelup(`/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(prof.email)}`),
              profesorLibreEnHora(prof.userId, hora, fecha),
              contarAlumnosTEA(prof.userId, bloque),
            ]);

            if (!libre || alumnosActuales >= MAX_ALUMNOS_POR_BLOQUE) return;

            const contacto = contactData?.contact;
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

      case 'asignar': {
        const { studentId, profesorContactoId, profesorUserId, profesorNombre, bloque, hora } = req.body || {};
        if (!studentId || !profesorContactoId || !bloque || !hora) {
          return send(res, 400, { ok: false, error: 'Datos incompletos' });
        }

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

        if (profesorUserId) {
          await funnelup(`/contacts/${studentId}`, {
            method: 'PUT',
            body: JSON.stringify({ assignedTo: profesorUserId }),
          });
        }

        return send(res, 200, { ok: true, mensaje: 'Asignación completada' });
      }

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

      // Endpoint de debug para ver el calendario raw de un profesor
      case 'debug_calendario': {
        const { userId, fecha } = req.query;
        if (!userId || !fecha) return send(res, 400, { ok: false, error: 'userId y fecha requeridos' });

        const fechaObj = new Date(fecha);
        const start    = new Date(fechaObj); start.setHours(0,0,0,0);
        const end      = new Date(fechaObj); end.setHours(23,59,59,999);

        // Probar los tres endpoints posibles en paralelo
        const [r1, r2, r3] = await Promise.allSettled([
          funnelup(`/calendars/availability?locationId=${LOCATION_ID}&userId=${userId}&startTime=${start.getTime()}&endTime=${end.getTime()}`),
          funnelup(`/users/${userId}/availability?locationId=${LOCATION_ID}&startTime=${start.getTime()}&endTime=${end.getTime()}`),
          funnelup(`/calendars/blocked-slots?locationId=${LOCATION_ID}&userId=${userId}&startTime=${start.getTime()}&endTime=${end.getTime()}`),
        ]);

        return send(res, 200, {
          ok: true,
          availability:    r1.status === 'fulfilled' ? r1.value : r1.reason?.message,
          user_avail:      r2.status === 'fulfilled' ? r2.value : r2.reason?.message,
          blocked_slots:   r3.status === 'fulfilled' ? r3.value : r3.reason?.message,
        });
      }

      default:
        return send(res, 400, { ok: false, error: 'Acción no reconocida' });
    }
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: err.message });
  }
};