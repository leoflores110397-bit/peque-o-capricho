// Manda por email la foto de UN ticket, al momento de sacarla.
import { admin, bajarTicket, base64, cors, hora, json, mandarEmail, nombreMedio, pesos, usuarioQueVende } from '../_shared/comun.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!(await usuarioQueVende(req))) return json({ error: 'No tenés permiso' }, 401);
    const { ticket_id } = await req.json();
    const db = admin();
    const { data: t } = await db.from('tickets').select('*, ventas(*)').eq('id', ticket_id).maybeSingle();
    if (!t) return json({ error: 'No se encontró el ticket' }, 404);
    const { data: config } = await db.from('config').select('email_tickets').eq('id', 1).single();
    if (!config?.email_tickets) return json({ error: 'Falta cargar el correo del local en Ajustes' }, 400);

    const foto = await bajarTicket(db, t.foto_path);
    const v = t.ventas;
    const detalle = v
      ? `${nombreMedio(v.medio, v.posnet)} · ${pesos(v.total)}${Number(v.recargo) > 0 ? ` (incluye recargo de ${pesos(v.recargo)})` : ''}`
      : 'Sin venta vinculada';
    await mandarEmail(
      config.email_tickets,
      `Ticket ${t.fecha} ${hora(t.creado_en)} · ${detalle}`,
      `<p>Ticket de posnet del <b>${t.fecha}</b> a las <b>${hora(t.creado_en)}</b>.</p><p>${detalle}</p>`,
      [{ filename: `ticket-${t.fecha}-${hora(t.creado_en).replace(':', '')}.jpg`, content: base64(foto) }],
    );
    await db.from('tickets').update({ enviado_en: new Date().toISOString() }).eq('id', t.id);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
