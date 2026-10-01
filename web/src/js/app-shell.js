window.AppUI = {
  localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
  toast(message, error = false) {
    let el = document.getElementById('appToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appToast';
      el.className = 'app-toast';
      document.body.appendChild(el);
    }
    clearTimeout(this.toastTimer);
    el.textContent = String(message || '');
    el.classList.toggle('error', error);
    el.setAttribute('role', error ? 'alert' : 'status');
    el.classList.add('show');
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 5000);
  }
};

document.querySelectorAll('[data-nav]').forEach((element) => {
  element.addEventListener('click', () => {
    const target = element.dataset.nav;
    if (target) window.location.href = target;
  });
});
document.querySelectorAll('[data-logout]').forEach((element) => {
  element.addEventListener('click', () => API.logout());
});
document.querySelectorAll('form[data-prevent-submit="true"]').forEach((form) => {
  form.addEventListener('submit', (event) => event.preventDefault());
});

const notificationPanel = document.getElementById('notificationPanel');
const notificationButton = document.getElementById('notificationBtn');
if (notificationPanel && notificationButton) {
  new MutationObserver(() => {
    notificationButton.setAttribute('aria-expanded', String(notificationPanel.classList.contains('show')));
  }).observe(notificationPanel, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && notificationPanel.classList.contains('show')) {
      notificationPanel.classList.remove('show');
      notificationButton.focus();
    }
  });
}
