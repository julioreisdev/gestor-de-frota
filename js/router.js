// Hash router simples. Rotas registradas via register(path, fn).
// path = '/dashboard'. Hash final = '#/dashboard'.

const routes = new Map();
let _current = null;
let _onChange = null;

export function register(path, handler, meta = {}) {
  routes.set(path, { handler, meta });
}

export function setOnChange(fn) { _onChange = fn; }

export function currentPath() {
  const h = location.hash || '#/';
  return h.startsWith('#') ? h.slice(1) : h;
}

export function navigate(path, replace = false) {
  const h = '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) location.replace(h);
  else location.hash = h;
}

let _started = false;
export function start() {
  if (!_started) {
    window.addEventListener('hashchange', resolve);
    _started = true;
  }
  resolve();
}

async function resolve() {
  const path = currentPath();
  const route = routes.get(path) || routes.get('*');
  if (!route) return;
  _current = { path, ...route };
  _onChange && _onChange(_current);
  try {
    await route.handler({ path, meta: route.meta });
  } catch (e) {
    console.error('Route handler error', e);
  }
}

export function getCurrent() { return _current; }
