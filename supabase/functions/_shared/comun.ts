// Código compartido por las funciones del servidor (Supabase Edge Functions, Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Cliente con permisos de servidor (salta RLS). Usar solo después de verificar al usuario. */
export const admin = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

/** Verifica que quien llama pueda vender (dueña, empleados o admin). Devuelve el id del usuario o null. */
export async function usuarioQueVende(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const db = admin();
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const { data: perfil } = await db.from('perfiles').select('rol').eq('id', data.user.id).maybeSingle();
  return perfil && ['duena', 'empleado', 'admin'].includes(perfil.rol) ? data.user.id : null;
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  const paso = 0x8000;
  for (let i = 0; i < bytes.length; i += paso) s += String.fromCharCode(...bytes.subarray(i, i + paso));
  return btoa(s);
}

export async function bajarTicket(db: SupabaseClient, ruta: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from('tickets').download(ruta);
  if (error || !data) throw new Error('No se encontró la foto del ticket');
  return new Uint8Array(await data.arrayBuffer());
}

export const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(Number(n) || 0);

export const hora = (t: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));

export const hoyLocal = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba' }).format(new Date());

export const nombreMedio = (medio: string, posnet?: string | null) => {
  const m: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', qr: 'QR', debito: 'Débito', credito: 'Crédito' };
  const p: Record<string, string> = { mercadopago: 'Mercado Pago', getnet: 'Getnet' };
  return posnet ? `${m[medio]} · ${p[posnet]}` : m[medio] ?? medio;
};

type Adjunto = { filename: string; content: string };

/** Manda un email con Resend (https://resend.com). */
export async function mandarEmail(para: string, asunto: string, html: string, adjuntos: Adjunto[] = []) {
  const clave = Deno.env.get('RESEND_API_KEY');
  if (!clave) throw new Error('Falta configurar el envío de emails (RESEND_API_KEY)');
  const de = Deno.env.get('EMAIL_REMITENTE') || 'Pequeño Capricho <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: de, to: [para], subject: asunto, html, attachments: adjuntos }),
  });
  if (!res.ok) throw new Error(`No se pudo mandar el email (${res.status}): ${await res.text()}`);
}
