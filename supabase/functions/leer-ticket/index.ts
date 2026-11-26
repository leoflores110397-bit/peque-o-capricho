// Lee la foto de un ticket de posnet con Claude (IA) para verificar monto y posnet.
import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0';
import { admin, bajarTicket, base64, cors, json, usuarioQueVende } from '../_shared/comun.ts';

const anthropic = new Anthropic(); // usa la variable ANTHROPIC_API_KEY

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['es_ticket', 'monto', 'posnet', 'tipo', 'aprobado'],
  properties: {
    es_ticket: { type: 'boolean', description: 'true si la imagen es un comprobante de posnet' },
    monto: { type: ['number', 'null'], description: 'Monto total cobrado en pesos, como número (ej: 12500.50)' },
    posnet: { type: 'string', enum: ['mercadopago', 'getnet', 'otro', 'no_se_lee'] },
    tipo: { type: 'string', enum: ['debito', 'credito', 'qr', 'no_se_lee'] },
    aprobado: { type: ['boolean', 'null'], description: 'true si el ticket dice APROBADA/APROBADO' },
  },
};

const INSTRUCCIONES = `Vas a ver la foto de un comprobante de un posnet de Argentina (Mercado Pago Point o Getnet).
Extraé el monto total cobrado (en pesos argentinos: el punto separa miles y la coma los decimales, "$12.500,50" es 12500.50),
qué posnet lo emitió, si fue débito, crédito o QR, y si la operación figura como aprobada.
Si un dato no se lee con claridad, no adivines: usá null para el monto o "no_se_lee" para posnet y tipo.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!(await usuarioQueVende(req))) return json({ error: 'No tenés permiso' }, 401);
    if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'La lectura con IA no está configurada' }, 400);
    const { ticket_id } = await req.json();
    const db = admin();
    const { data: t } = await db.from('tickets').select('*, ventas(*)').eq('id', ticket_id).maybeSingle();
    if (!t) return json({ error: 'No se encontró el ticket' }, 404);

    const foto = await bajarTicket(db, t.foto_path);
    const respuesta = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64(foto) } },
          { type: 'text', text: INSTRUCCIONES },
        ],
      }],
    });

    if (respuesta.stop_reason === 'refusal') return json({ error: 'No se pudo leer este ticket' }, 422);
    const texto = respuesta.content.find((b) => b.type === 'text');
    if (!texto || texto.type !== 'text') return json({ error: 'No se pudo leer este ticket' }, 422);
    const lectura = JSON.parse(texto.text);

    // ¿coincide con la venta vinculada?
    let coincide: boolean | null = null;
    const v = t.ventas;
    if (v && lectura.es_ticket && lectura.monto !== null) {
      const mismoMonto = Math.abs(Number(lectura.monto) - Number(v.total)) < 1;
      const mismoPosnet = !['mercadopago', 'getnet'].includes(lectura.posnet) || !v.posnet || lectura.posnet === v.posnet;
      coincide = mismoMonto && mismoPosnet;
    }

    const posnetLeido = ['mercadopago', 'getnet'].includes(lectura.posnet) ? lectura.posnet : null;
    await db.from('tickets').update({
      monto_leido: lectura.monto, posnet_leido: posnetLeido, lectura, coincide,
    }).eq('id', t.id);

    return json({ ...lectura, coincide });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'La IA está ocupada. Probá en un minuto.' }, 429);
    if (e instanceof Anthropic.APIConnectionError) return json({ error: 'No se pudo conectar con la IA. Probá de nuevo.' }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: `Error de la IA (${e.status})` }, 502);
    return json({ error: (e as Error).message }, 500);
  }
});
