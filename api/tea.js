// TEA Portal API - FunnelUp Bridge
// Vercel Serverless Function

const FUNNELUP_API = 'https://services.leadconnectorhq.com';
const LOCATION_ID  = '9cXtL7yJiTR3U0C2xmDt';
const API_KEY      = process.env.FUNNELUP_API_KEY; // set in Vercel env vars

const PROFESORES = [
  { nombre: 'Daniela Guzman',     userId: '8nZnZoJ4THtn2KwuFiqD', email: 'gladismarguzman@gmail.com'        },
  { nombre: 'David Gonzalez',     userId: 'ruaficj9PgvxfYsy0NfX', email: 'davidsecundaria20@gmail.com'      },
  { nombre: 'Isabella Rodríguez', userId: 'M6PmhYh3fqrFjcxyfdj5', email: 'isabellarodriguez.am@gmail.com'  },
  { nombre: 'Jeffry Ferrer',      userId: 'agZ9APmwt6J62RoEdUcX', email: 'ferrerjeffry9@gmail.com'         },
  { nombre: 'Militza Castañeda',  userId: 'ufSR1xGQmBXgON6vMSRT', email: 'milidelvalle2000@gmail.com'      },
  { nombre: 'Nathaly Regardiz',   userId: 'DPeRW5cYIErHZ6AXOmf7', email: 'janathaly16@gmail.com'           },
];

const MAX_ALUMNOS_POR_BLOQUE = 3;

// ─── helpers ────────────────────────────────────────────────────────────────

function headers(extra = {}) {
  return {
    'Private-Integration-Token': API_KEY,
    'Content-Type':              'application/json',
    'Version':                   '2021-07-28',
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

// ─── endpoint router ─────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    switch (action) {

      // ── 1. LOGIN: verifica tag tea-student ──────────────────────────────
      case 'login': {
        const { email, password } = req.body || {};
        if (!email) return send(res, 400, { ok: false, error: 'Email requerido' });

        // Buscar contacto por email
        const data = await funnelup(
          `/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(email)}`
        );

        const contact = data?.contact;
        if (!contact) return send(res, 401, { ok: false, error: 'NO_STUDENT' });

        // Verificar tag tea-student
        const tags = (contact.tags || []).map(t => t.toLowerCase());
        if (!tags.includes('tea-student')) {
          return send(res, 401, { ok: false, error: 'NO_TAG' });
        }

        // Verificar contraseña — comparamos contra custom field tea_password
        // Si no existe aún, usamos los últimos 4 dígitos del teléfono como PIN temporal
        const storedPass = contact.customFields?.find(f => f.key === 'tea_password')?.value;
        const phone      = contact.phone || '';
        const fallback   = phone.replace(/\D/g, '').slice(-4);
        const validPass  = storedPass ? storedPass === password : fallback === password;

        if (!validPass) return send(res, 401, { ok: false, error: 'WRONG_PASS' });

        // Verificar si ya tiene horario asignado
        const yaAsignado = contact.customFields?.find(f => f.key === 'tea_horario_asignado')?.value;

        return send(res, 200, {
          ok: true,
          student: {
            id:          contact.id,
            nombre:      `${contact.firstName} ${contact.lastName}`.trim(),
            email:       contact.email,
            yaAsignado:  !!yaAsignado,
            horario:     yaAsignado || null,
          },
        });
      }

      // ── 2. PROFESORES DISPONIBLES por bloque ────────────────────────────
      case 'profesores': {
        const { bloque } = req.query;
        if (!bloque) return send(res, 400, { ok: false, error: 'Bloque requerido' });

        const disponibles = [];

        for (const prof of PROFESORES) {
          // Buscar contacto del profesor por email
          const data = await funnelup(
            `/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(prof.email)}`
          );
          const contacto = data?.contact;
          if (!contacto) continue;

          // Verificar si trabaja en ese bloque
          const bloques = contacto.customFields?.find(
            f => f.key === 'disponibilidad_de_bloques'
          )?.value || [];

          const bloqueArr = Array.isArray(bloques) ? bloques : [bloques];
          if (!bloqueArr.includes(bloque)) continue;

          // Contar alumnos actuales en ese bloque
          const alumnosField = contacto.customFields?.find(
            f => f.key === `tea_alumnos_${bloque}`
          )?.value || '0';
          const alumnosActuales = parseInt(alumnosField, 10) || 0;

          if (alumnosActuales >= MAX_ALUMNOS_POR_BLOQUE) continue;

          disponibles.push({
            id:             contacto.id,
            userId:         prof.userId,
            nombre:         prof.nombre,
            bio:            contacto.customFields?.find(f => f.key === 'tea_bio')?.value || '',
            videoUrl:       contacto.customFields?.find(f => f.key === 'tea_video_url')?.value || '',
            cuposDisponibles: MAX_ALUMNOS_POR_BLOQUE - alumnosActuales,
            bloque,
          });
        }

        return send(res, 200, { ok: true, profesores: disponibles });
      }

      // ── 3. CONFIRMAR asignación estudiante → profesor ────────────────────
      case 'asignar': {
        const { studentId, profesorContactoId, profesorUserId, profesorNombre, bloque, hora } = req.body || {};
        if (!studentId || !profesorContactoId || !bloque || !hora) {
          return send(res, 400, { ok: false, error: 'Datos incompletos' });
        }

        // 3a. Actualizar contacto del estudiante con su asignación
        const horarioStr = JSON.stringify({ bloque, hora, profesor: profesorNombre, profesorId: profesorContactoId });
        await funnelup(`/contacts/${studentId}`, {
          method: 'PUT',
          body: JSON.stringify({
            customFields: [
              { key: 'tea_horario_asignado', field_value: horarioStr },
              { key: 'tea_profesor_asignado', field_value: profesorNombre },
              { key: 'tea_bloque', field_value: bloque },
              { key: 'tea_hora', field_value: hora },
            ],
          }),
        });

        // 3b. Incrementar contador de alumnos del profesor en ese bloque
        const profData = await funnelup(
          `/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(
            PROFESORES.find(p => p.userId === profesorUserId)?.email || ''
          )}`
        );
        const profContacto = profData?.contact;
        if (profContacto) {
          const campoAlumnos = `tea_alumnos_${bloque}`;
          const actual = parseInt(
            profContacto.customFields?.find(f => f.key === campoAlumnos)?.value || '0', 10
          );
          await funnelup(`/contacts/${profContacto.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              customFields: [
                { key: campoAlumnos, field_value: String(actual + 1) },
              ],
            }),
          });
        }

        // 3c. Asignar el profesor como usuario responsable del contacto estudiante
        if (profesorUserId) {
          await funnelup(`/contacts/${studentId}`, {
            method: 'PUT',
            body: JSON.stringify({ assignedTo: profesorUserId }),
          });
        }

        return send(res, 200, { ok: true, mensaje: 'Asignación completada' });
      }

      // ── 4. DASHBOARD: datos del estudiante ya asignado ──────────────────
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

      default:
        return send(res, 400, { ok: false, error: 'Acción no reconocida' });
    }
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: err.message });
  }
};