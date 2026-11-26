// Acceso con el correo del local + el DNI de cada persona.
// En Supabase cada persona es un usuario distinto. Su "correo de acceso" se arma solo
// a partir del correo del local y un código sacado del DNI (el DNI no queda escrito en ningún lado):
//   pequenocapricho@gmail.com + DNI 30123456  ->  pequenocapricho+u1a2b3c4d5e@gmail.com
// Se usa igual desde la app y desde scripts/crear-accesos.mjs.

export const normalizarDni = (dni) => String(dni ?? '').replace(/\D/g, '');

export const normalizarCorreo = (correo) => String(correo ?? '').trim().toLowerCase();

export function dniValido(dni) {
  const d = normalizarDni(dni);
  return d.length >= 7 && d.length <= 9;
}

async function sha256(texto) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Correo de acceso de una persona, a partir del correo del local y su DNI. */
export async function correoDeAcceso(correoLocal, dni) {
  const correo = normalizarCorreo(correoLocal);
  const [usuario, dominio] = correo.split('@');
  if (!usuario || !dominio) throw new Error('El correo del local no parece bien escrito');
  const codigo = (await sha256(`${normalizarDni(dni)}:${correo}`)).slice(0, 12);
  return `${usuario.split('+')[0]}+u${codigo}@${dominio}`;
}
