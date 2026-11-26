// Crea (o actualiza) los accesos: correo del local + DNI de cada persona.
//
// Uso:
//   1. Copiar scripts/accesos.ejemplo.json a scripts/accesos.json y completar los DNI reales.
//      (accesos.json NO se sube a GitHub: está en .gitignore)
//   2. Correr:
//        SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/crear-accesos.mjs
//      La service_role key está en Supabase > Project Settings > API. Es secreta: no pegarla en la app.
//
// Se puede correr de nuevo para cambiar un DNI, un nombre o un rol, o para sumar una persona.
import { readFile } from 'node:fs/promises';
import { correoDeAcceso, dniValido, normalizarDni } from '../js/acceso.js';

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, '');
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !CLAVE) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ver instrucciones arriba del archivo).');
  process.exit(1);
}

const archivo = new URL('./accesos.json', import.meta.url);
let datos;
try {
  datos = JSON.parse(await readFile(archivo, 'utf8'));
} catch {
  console.error('No se pudo leer scripts/accesos.json. Copiá accesos.ejemplo.json y completalo.');
  process.exit(1);
}

datos.correo_local = String(datos.correo_local || '').replace(/\s/g, '').toLowerCase();

const encabezados = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' };
const pedir = async (ruta, opciones = {}) => {
  const res = await fetch(`${URL_BASE}${ruta}`, { ...opciones, headers: { ...encabezados, ...opciones.headers } });
  const cuerpo = await res.text();
  return { ok: res.ok, status: res.status, datos: cuerpo ? JSON.parse(cuerpo) : null };
};

async function buscarUsuario(email) {
  for (let pagina = 1; ; pagina++) {
    const r = await pedir(`/auth/v1/admin/users?page=${pagina}&per_page=200`);
    if (!r.ok) throw new Error(`No se pudo listar usuarios (${r.status})`);
    const encontrado = r.datos.users.find((u) => u.email === email);
    if (encontrado || r.datos.users.length < 200) return encontrado;
  }
}

const dnis = new Set();
for (const p of datos.personas) {
  const dni = normalizarDni(p.dni);
  if (!p.nombre || !dniValido(dni)) throw new Error(`Revisá el nombre y el DNI de "${p.nombre || '?'}"`);
  if (!['duena', 'empleado', 'ayudante', 'admin'].includes(p.rol)) throw new Error(`Rol desconocido para ${p.nombre}: ${p.rol}`);
  if (dnis.has(dni)) throw new Error(`El DNI de ${p.nombre} está repetido`);
  dnis.add(dni);

  const email = await correoDeAcceso(datos.correo_local, dni);
  const usuario = {
    email, password: dni, email_confirm: true,
    user_metadata: { nombre: p.nombre, rol: p.rol },
  };
  let id;
  const creado = await pedir('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify(usuario) });
  if (creado.ok) {
    id = creado.datos.id;
    console.log(`✓ ${p.nombre}: acceso creado`);
  } else {
    const existente = await buscarUsuario(email);
    if (!existente) throw new Error(`No se pudo crear a ${p.nombre}: ${JSON.stringify(creado.datos)}`);
    id = existente.id;
    const act = await pedir(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(usuario) });
    if (!act.ok) throw new Error(`No se pudo actualizar a ${p.nombre}: ${JSON.stringify(act.datos)}`);
    console.log(`✓ ${p.nombre}: acceso actualizado`);
  }
  // nombre y rol en la tabla de perfiles
  const perfil = await pedir('/rest/v1/perfiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, nombre: p.nombre, rol: p.rol }),
  });
  if (!perfil.ok) throw new Error(`No se pudo guardar el perfil de ${p.nombre}: ${JSON.stringify(perfil.datos)}`);
}
// correo para las fotos de tickets (Más › Ajustes)
if (datos.email_tickets) {
  const email = String(datos.email_tickets).replace(/\s/g, '').toLowerCase();
  const r = await pedir('/rest/v1/config?id=eq.1', { method: 'PATCH', body: JSON.stringify({ email_tickets: email }) });
  if (!r.ok) throw new Error(`No se pudo guardar el correo de tickets: ${JSON.stringify(r.datos)}`);
  console.log(`✓ Correo para tickets: ${email}`);
}

console.log(`\nListo. Para entrar: correo ${datos.correo_local} + el DNI de cada uno (sin puntos).`);
