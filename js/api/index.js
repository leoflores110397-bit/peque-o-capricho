// Elige la conexión: Supabase si está configurado, si no el modo de prueba.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const usarNube = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const api = usarNube ? await import('./supabase.js') : await import('./demo.js');
