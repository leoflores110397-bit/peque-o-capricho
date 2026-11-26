// Modo claro / oscuro. 'auto' sigue la configuración del aparato.
export const temaGuardado = () => {
  try { return localStorage.getItem('pc-tema') || 'auto'; } catch { return 'auto'; }
};

export function aplicarTema(tema = temaGuardado(), guardar = false) {
  const raiz = document.documentElement;
  if (tema === 'claro') raiz.dataset.theme = 'light';
  else if (tema === 'oscuro') raiz.dataset.theme = 'dark';
  else delete raiz.dataset.theme;
  if (guardar) { try { localStorage.setItem('pc-tema', tema); } catch { /* nada */ } }
  const oscuro = raiz.dataset.theme === 'dark' || (!raiz.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#1a1033' : '#5A17EB');
}
