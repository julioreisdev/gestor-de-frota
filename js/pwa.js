// PWA — captura prompt de instalação, oferece fallback iOS, registra SW.
import { openModal, closeModal } from './ui.js';
import { icons } from './icons.js';

let _deferredPrompt = null;
const _listeners = new Set();

// Chrome/Edge/Android: o navegador dispara este evento quando o site é
// elegível à instalação. Capturamos para mostrar nosso próprio botão.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredPrompt = e;
  _notify();
});

// Quando o usuário conclui a instalação, limpa o prompt e atualiza UI.
window.addEventListener('appinstalled', () => {
  _deferredPrompt = null;
  _notify();
});

function _notify() { _listeners.forEach((fn) => fn(canInstall())); }

export function onInstallStateChange(fn) {
  _listeners.add(fn);
  // emite estado inicial
  queueMicrotask(() => fn(canInstall()));
  return () => _listeners.delete(fn);
}

/** Já está rodando como app instalado (standalone)? */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || window.navigator.standalone === true; // iOS Safari
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad em iPadOS
}

export function isIOSSafari() {
  if (!isIOS()) return false;
  const ua = navigator.userAgent;
  // Chrome/Firefox/Edge no iOS NÃO suportam add-to-home-screen
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Mostra o botão se: não está instalado E (tem prompt OU é iOS Safari). */
export function canInstall() {
  if (isStandalone()) return false;
  if (_deferredPrompt) return true;
  if (isIOSSafari()) return true;
  return false;
}

/** Dispara fluxo de instalação adequado ao navegador. */
export async function install() {
  if (_deferredPrompt) {
    _deferredPrompt.prompt();
    const choice = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    _notify();
    return choice.outcome === 'accepted';
  }
  if (isIOSSafari()) {
    _showIOSInstructions();
    return false;
  }
  return false;
}

function _showIOSInstructions() {
  openModal({
    title: 'Instalar no iPhone / iPad',
    body: `
      <p style="font-size:13.5px;color:var(--text-soft);margin-bottom:16px">
        O Safari não tem botão automático. Em 3 toques fica pronto:
      </p>
      <ol style="font-size:14px;line-height:1.7;padding-left:1.2em;color:var(--text)">
        <li>Toque no ícone <strong>Compartilhar</strong> na barra inferior do Safari
            (quadrado com seta pra cima).</li>
        <li>Role um pouco e toque em <strong>"Adicionar à Tela de Início"</strong>.</li>
        <li>Confirme tocando em <strong>"Adicionar"</strong> no canto superior direito.</li>
      </ol>
      <p style="font-size:12px;color:var(--text-muted);margin-top:16px;padding:10px;background:var(--surface-alt);border-radius:8px">
        Funciona apenas no Safari nativo do iPhone/iPad. Chrome, Firefox e Edge no iOS
        não permitem instalar apps.
      </p>
    `,
    footer: '<button class="btn btn-primary" id="pwa-ios-ok">Entendi</button>',
  });
  document.getElementById('pwa-ios-ok').addEventListener('click', closeModal);
}

/** Registra service worker (necessário pra ser PWA installable). */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  // não polui devtools com warnings se SW falhar (ex: rota de teste sem sw.js)
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => {
    console.warn('[PWA] Service worker não registrado:', e.message);
  });
}
