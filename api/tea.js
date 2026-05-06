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

// IDs reales de custom fields del estudiante
const FIELD_IDS = {
  tea_horario_asignado:  'D21J2OhL2lbShnJUFCqm',
  tea_bloque:            'KoZo29futqnIujB4igX3',
  tea_profesor_asignado: 'bM4AbwxNURruK2Ztza3W',
  tea_hora:              'khp9riWSgCna58A6O4pd',
  teacher_id:            'lqmCt3gqk1UMheYDbG7A',
  tea_fecha_inicio:      '1YAuS54toIr124DvkjOY',
  tea_reset_code:        'O6DW7jSKAejRUg7NbKth',
  tea_reset_expira:      'PFXIAbQHhzPmn4k3MNYz',
};

function cfById(contact, nombre) {
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
  const campoVal = contacto?.customFields?.find(f => f.key === campoKey)?.value;
  if (campoVal !== undefined && campoVal !== null && campoVal !== '') return parseInt(campoVal, 10) || 0;
  return ALUMNOS_INICIALES[email]?.[bloque] ?? 0;
}

// Ajusta el contador de un profesor: delta = +1 o -1
async function ajustarContadorProfesor(profesorContactoId, profesorEmail, bloque, delta) {
  if (!profesorContactoId || !bloque) return;
  try {
    const profData    = await funnelup(`/contacts/${profesorContactoId}`);
    const profContact = profData?.contact;
    if (!profContact) return;
    const campoKey = `tea_alumnos_${bloque}`;
    const actual   = leerAlumnosEnBloque(profContact, profesorEmail || '', bloque);
    const nuevo    = Math.max(0, actual + delta); // nunca bajar de 0
    await funnelup(`/contacts/${profesorContactoId}`, {
      method: 'PUT',
      body: JSON.stringify({
        customFields: [{ key: campoKey, field_value: String(nuevo) }],
      }),
    });
    console.log(`Contador ${profesorEmail} bloque ${bloque}: ${actual} → ${nuevo}`);
  } catch(e) { console.error(`Error ajustando contador ${profesorContactoId}:`, e.message); }
}

function calcularProgreso(fechaInicio) {
  if (!fechaInicio) return { semana: 1, fase: 1 };
  const inicio = new Date(fechaInicio);
  if (isNaN(inicio)) return { semana: 1, fase: 1 };
  const dias   = Math.floor((new Date() - inicio) / (1000 * 60 * 60 * 24));
  const semana = Math.max(1, Math.min(26, Math.floor(dias / 7) + 1));
  let fase = 1;
  if      (semana <= 6)  fase = 1;
  else if (semana <= 16) fase = 2;
  else if (semana <= 22) fase = 3;
  else                   fase = 4;
  return { semana, fase };
}

// Genera código de 6 dígitos
function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

      // ── FORGOT PASSWORD — paso 1: generar y enviar código ────────────────
      case 'forgot_request': {
        const { email } = req.body || {};
        if (!email) return send(res, 400, { ok: false, error: 'Email requerido' });

        const data    = await funnelup(`/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(email)}`);
        const contact = data?.contact;

        // Siempre responder igual para no revelar si el email existe
        if (!contact) return send(res, 200, { ok: true, mensaje: 'Si el correo existe, recibirás un código.' });

        const tags = (contact.tags || []).map(t => t.toLowerCase());
        if (!tags.includes('tea-student')) return send(res, 200, { ok: true, mensaje: 'Si el correo existe, recibirás un código.' });

        const codigo  = generarCodigo();
        const expira  = Date.now() + 15 * 60 * 1000; // 15 minutos

        // Guardar código + expiración en custom field
        await funnelup(`/contacts/${contact.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            customFields: [
              { key: 'tea_reset_code',    field_value: codigo          },
              { key: 'tea_reset_expira',  field_value: String(expira)  },
            ],
          }),
        });

        // Enviar email via Resend
        try {
          const emailHtml = `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
              <div style="background:#0F145B;padding:20px;border-radius:12px 12px 0 0;text-align:center">
                <span style="color:#EA0029;font-weight:700;font-size:18px;letter-spacing:1px">TALK</span>
                <span style="color:#fff;font-weight:700;font-size:18px;letter-spacing:1px"> ENGLISH ACADEMY</span>
              </div>
              <div style="background:#fff;border:1px solid #e2e6f0;padding:32px;border-radius:0 0 12px 12px">
                <h2 style="color:#0F145B;margin:0 0 16px">Código de verificación</h2>
                <p style="color:#6b7280;margin:0 0 24px;line-height:1.6">
                  Hola ${contact.firstName}, usa este código para restablecer tu contraseña.
                  Expira en <strong>15 minutos</strong>.
                </p>
                <div style="background:#f4f6fb;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px">
                  <span style="font-size:36px;font-weight:700;color:#EA0029;letter-spacing:8px">${codigo}</span>
                </div>
                <p style="color:#aaa;font-size:12px;margin:0">
                  Si no solicitaste este código, ignora este mensaje. Tu cuenta sigue segura.
                </p>
              </div>
            </div>
          `;

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({
              from:    'Talk English Academy <onboarding@resend.dev>',
              to:      [contact.email],
              subject: 'Tu código de acceso — Talk English Academy',
              html:    emailHtml,
            }),
          });

          const resendData = await resendRes.json();
          if (!resendRes.ok) {
            console.error('Resend error:', resendRes.status, JSON.stringify(resendData));
          } else {
            console.log('Email enviado via Resend:', resendData.id, '→', contact.email);
          }
        } catch(emailErr) {
          console.error('Error enviando email:', emailErr.message);
        }

        return send(res, 200, { ok: true, contactId: contact.id, mensaje: 'Código enviado. Revisa tu correo.' });
      }

      // ── FORGOT PASSWORD — paso 2: verificar código ───────────────────────
      case 'forgot_verify': {
        const { contactId, codigo } = req.body || {};
        if (!contactId || !codigo) return send(res, 400, { ok: false, error: 'Datos incompletos' });

        const data    = await funnelup(`/contacts/${contactId}`);
        const contact = data?.contact;
        if (!contact) return send(res, 400, { ok: false, error: 'Contacto no encontrado' });

        const storedCode  = cfById(contact, 'tea_reset_code');
        const storedExpira = cfById(contact, 'tea_reset_expira');

        if (!storedCode || storedCode !== codigo) {
          return send(res, 400, { ok: false, error: 'INVALID_CODE' });
        }

        if (!storedExpira || Date.now() > parseInt(storedExpira)) {
          return send(res, 400, { ok: false, error: 'EXPIRED_CODE' });
        }

        return send(res, 200, { ok: true, mensaje: 'Código válido' });
      }

      // ── FORGOT PASSWORD — paso 3: cambiar contraseña ─────────────────────
      case 'forgot_reset': {
        const { contactId, codigo, nuevaPassword } = req.body || {};
        if (!contactId || !codigo || !nuevaPassword) {
          return send(res, 400, { ok: false, error: 'Datos incompletos' });
        }

        const data    = await funnelup(`/contacts/${contactId}`);
        const contact = data?.contact;
        if (!contact) return send(res, 400, { ok: false, error: 'Contacto no encontrado' });

        const storedCode   = cfById(contact, 'tea_reset_code');
        const storedExpira = cfById(contact, 'tea_reset_expira');

        if (!storedCode || storedCode !== codigo) return send(res, 400, { ok: false, error: 'INVALID_CODE' });
        if (!storedExpira || Date.now() > parseInt(storedExpira)) return send(res, 400, { ok: false, error: 'EXPIRED_CODE' });

        if (nuevaPassword.length < 6) return send(res, 400, { ok: false, error: 'PASSWORD_SHORT' });

        // Guardar nueva contraseña y limpiar código de reset
        await funnelup(`/contacts/${contactId}`, {
          method: 'PUT',
          body: JSON.stringify({
            customFields: [
              { key: 'tea_password',     field_value: nuevaPassword },
              { key: 'tea_reset_code',   field_value: ''            },
              { key: 'tea_reset_expira', field_value: ''            },
            ],
          }),
        });

        return send(res, 200, { ok: true, mensaje: 'Contraseña actualizada correctamente' });
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

      // ── ASIGNAR (con manejo de reasignación) ─────────────────────────────
      case 'asignar': {
        const { studentId, profesorContactoId, profesorUserId, profesorNombre, profesorEmail, bloque, hora } = req.body || {};
        if (!studentId || !profesorContactoId || !bloque || !hora) {
          return send(res, 400, { ok: false, error: 'Datos incompletos' });
        }

        // 1. Leer datos ANTERIORES del estudiante para manejar reasignación
        let profesorAnteriorId    = null;
        let profesorAnteriorEmail = null;
        let bloqueAnterior        = null;

        try {
          const studentData = await funnelup(`/contacts/${studentId}`);
          const studentContact = studentData?.contact;
          if (studentContact) {
            const teacherIdAnterior = cfById(studentContact, 'teacher_id');
            bloqueAnterior          = cfById(studentContact, 'tea_bloque');

            if (teacherIdAnterior && bloqueAnterior) {
              // Buscar contacto del profesor anterior
              const profAnterior = PROFESORES.find(p => p.userId === teacherIdAnterior);
              if (profAnterior) {
                const profAntData = await funnelup(`/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(profAnterior.email)}`);
                profesorAnteriorId    = profAntData?.contact?.id;
                profesorAnteriorEmail = profAnterior.email;
              }
            }
          }
        } catch(e) { console.error('Error leyendo datos anteriores:', e.message); }

        // 2. Actualizar contacto del estudiante
        const horarioStr = JSON.stringify({ bloque, hora, profesor: profesorNombre, profesorId: profesorContactoId });
        const hoy        = new Date().toISOString().split('T')[0];

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

        // 3. Asignar profesor como responsable
        if (profesorUserId) {
          await funnelup(`/contacts/${studentId}`, {
            method: 'PUT',
            body: JSON.stringify({ assignedTo: profesorUserId }),
          });
        }

        // 4. Bajar cupo al profesor ANTERIOR si existía y era diferente o diferente bloque
        const esReasignacion = profesorAnteriorId &&
          (profesorAnteriorId !== profesorContactoId || bloqueAnterior !== bloque);

        if (esReasignacion && profesorAnteriorId && bloqueAnterior) {
          await ajustarContadorProfesor(profesorAnteriorId, profesorAnteriorEmail, bloqueAnterior, -1);
        }

        // 5. Subir cupo al nuevo profesor (solo si es nuevo o cambió de bloque)
        if (esReasignacion || !profesorAnteriorId) {
          await ajustarContadorProfesor(profesorContactoId, profesorEmail || '', bloque, +1);
        } else if (!esReasignacion && !profesorAnteriorId) {
          // Primera asignación
          await ajustarContadorProfesor(profesorContactoId, profesorEmail || '', bloque, +1);
        }

        return send(res, 200, { ok: true, mensaje: 'Asignación completada', reasignado: !!esReasignacion });
      }

      // ── DASHBOARD ────────────────────────────────────────────────────────
      case 'dashboard': {
        const { studentId } = req.query;
        if (!studentId) return send(res, 400, { ok: false, error: 'studentId requerido' });

        const data    = await funnelup(`/contacts/${studentId}`);
        const contact = data?.contact;
        if (!contact) return send(res, 404, { ok: false, error: 'Estudiante no encontrado' });

        const { semana, fase } = calcularProgreso(cfById(contact, 'tea_fecha_inicio'));

        let profesorTelefono = '';
        const teacherId = cfById(contact, 'teacher_id');
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
            bloque:           cfById(contact, 'tea_bloque'),
            hora:             cfById(contact, 'tea_hora'),
            profesor:         cfById(contact, 'tea_profesor_asignado'),
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