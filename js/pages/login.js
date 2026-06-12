import { APP_NAME, APP_FAVICON } from '../config.js';
import { login } from '../auth.js';
import { esc } from '../ui.js';
import { icons } from '../icons.js';

export function renderLogin() {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <img src="${APP_FAVICON}" alt="${esc(APP_NAME)}">
          <h1>${esc(APP_NAME)}</h1>
          <p>Gestão de frota municipal</p>
        </div>
        <form class="login-form" id="login-form" autocomplete="off">
          <!-- inputs honeypot pra confundir autofill agressivo do Chrome -->
          <input type="text" name="fake-user" style="display:none" tabindex="-1" autocomplete="off">
          <input type="password" name="fake-pass" style="display:none" tabindex="-1" autocomplete="off">
          <div class="field">
            <label class="field-label" for="lg-user">Usuário</label>
            <input class="input" id="lg-user" name="username" type="text"
                   autocomplete="off" required autofocus
                   placeholder="Usuário">
          </div>
          <div class="field">
            <label class="field-label" for="lg-pass">Senha</label>
            <input class="input" id="lg-pass" name="password" type="password"
                   autocomplete="new-password" required
                   placeholder="••••••••">
          </div>
          <div id="login-error" class="login-error hidden"></div>
          <button class="btn btn-primary btn-block btn-lg" type="submit" id="login-btn">
            Entrar
          </button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  const errBox = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  // Limpa autofill agressivo do Chrome (que preenche DEPOIS do JS renderizar).
  const clearAutofill = () => {
    form.username.value = '';
    form.password.value = '';
  };
  clearAutofill();
  setTimeout(clearAutofill, 100);
  setTimeout(clearAutofill, 300);
  setTimeout(() => form.username.focus(), 350);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Entrando...';
    try {
      const username = form.username.value;
      const password = form.password.value;
      await login(username, password);
      // app.js detecta via onAuthStateChange e re-renderiza shell
    } catch (err) {
      errBox.textContent = err.message || 'Falha ao entrar.';
      errBox.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}
