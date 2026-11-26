// Se ejecuta todas las noches (ver supabase/cron.sql):
//  1) manda por email el resumen del día con las fotos de tickets que no se mandaron
//  2) guarda una copia de seguridad completa en el depósito "respaldos"
import { admin, bajarTicket, base64, cors, hora, hoyLocal, json, mandarEmail, nombreMedio, pesos } from '../_shared/comun.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'No autorizado' }, 401);

  const db = admin();
  const fecha = hoyLocal();
  const salida: Record<string, unknown> = { fecha };

  // ---------- 1) resumen por email ----------
  try {
    const { data: config } = await db.from('config').select('*').eq('id', 1).single();
    if (config?.email_tickets && config.email_modo !== 'no') {
      const { data: ventas } = await db.from('ventas').select('*').eq('fecha', fecha).eq('anulada', false).order('creado_en');
      const { data: caja } = await db.from('cajas').select('*').eq('fecha', fecha).maybeSingle();
      const { data: tickets } = await db.from('tickets').select('*').eq('fecha', fecha).is('enviado_en', null).order('creado_en');

      const suma = (f: (v: Record<string, unknown>) => boolean) =>
        (ventas ?? []).filter(f).reduce((s, v) => s + Number(v.total), 0);
      const filas = [
        ['Efectivo', suma((v) => v.medio === 'efectivo')],
        ['Transferencia', suma((v) => v.medio === 'transferencia')],
        ['QR', suma((v) => v.medio === 'qr')],
        ['Débito · Mercado Pago', suma((v) => v.medio === 'debito' && v.posnet === 'mercadopago')],
        ['Débito · Getnet', suma((v) => v.medio === 'debito' && v.posnet === 'getnet')],
        ['Crédito · Mercado Pago', suma((v) => v.medio === 'credito' && v.posnet === 'mercadopago')],
        ['Crédito · Getnet', suma((v) => v.medio === 'credito' && v.posnet === 'getnet')],
      ] as const;
      const total = suma(() => true);
      const recargos = (ventas ?? []).filter((v) => Number(v.recargo) > 0);
      const cajaTxt = !caja ? 'No se abrió la caja.'
        : caja.estado === 'cerrada'
          ? `Caja cerrada. Esperado ${pesos(caja.efectivo_esperado)}, contado ${pesos(caja.efectivo_contado)}, diferencia ${pesos(caja.diferencia)}.`
          : 'La caja quedó sin cerrar.';

      const adjuntos = [];
      for (const t of tickets ?? []) {
        try {
          adjuntos.push({ filename: `ticket-${hora(t.creado_en).replace(':', '')}.jpg`, content: base64(await bajarTicket(db, t.foto_path)) });
        } catch { /* foto faltante: se sigue con las demás */ }
      }

      const html = `
        <h2>Pequeño Capricho · resumen del ${fecha}</h2>
        <p><b>Total vendido: ${pesos(total)}</b> (${ventas?.length ?? 0} ventas)</p>
        <table cellpadding="6" style="border-collapse:collapse">
          ${filas.map(([n, m]) => `<tr><td>${n}</td><td align="right"><b>${pesos(m)}</b></td></tr>`).join('')}
        </table>
        <p>Recargos cobrados: ${recargos.length} (${pesos(recargos.reduce((s, v) => s + Number(v.recargo), 0))})</p>
        <p>${cajaTxt}</p>
        <h3>Ventas con tarjeta y QR</h3>
        <ul>${(ventas ?? []).filter((v) => v.medio !== 'efectivo' && v.medio !== 'transferencia')
          .map((v) => `<li>${hora(v.creado_en)} · ${nombreMedio(v.medio, v.posnet)} · ${pesos(v.total)}</li>`).join('') || '<li>Ninguna</li>'}</ul>
        <p>${adjuntos.length} foto(s) de tickets adjuntas.</p>`;

      // solo se manda si hubo movimiento
      if ((ventas?.length ?? 0) > 0 || adjuntos.length > 0) {
        await mandarEmail(config.email_tickets, `Resumen del día ${fecha} · ${pesos(total)}`, html, adjuntos);
        if (tickets?.length) {
          await db.from('tickets').update({ enviado_en: new Date().toISOString() }).in('id', tickets.map((t) => t.id));
        }
        salida.email = `enviado con ${adjuntos.length} tickets`;
      } else {
        salida.email = 'sin movimiento, no se mandó';
      }
    }
  } catch (e) {
    salida.error_email = (e as Error).message;
  }

  // ---------- 2) copia de seguridad ----------
  try {
    const copia: Record<string, unknown> = { exportado_en: new Date().toISOString() };
    for (const tabla of ['config', 'perfiles', 'productos', 'ventas', 'cajas', 'tickets', 'movimientos_stock']) {
      const filas: unknown[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await db.from(tabla).select('*').order(tabla === 'cajas' ? 'fecha' : 'id').range(desde, desde + 999);
        if (error) throw error;
        filas.push(...data);
        if (data.length < 1000) break;
      }
      copia[tabla] = filas;
    }
    const { error } = await db.storage.from('respaldos').upload(
      `${fecha}.json`,
      new Blob([JSON.stringify(copia)], { type: 'application/json' }),
      { upsert: true, contentType: 'application/json' },
    );
    if (error) throw error;
    salida.respaldo = `${fecha}.json`;
  } catch (e) {
    salida.error_respaldo = (e as Error).message;
  }

  return json(salida);
});
