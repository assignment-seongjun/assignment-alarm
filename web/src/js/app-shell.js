document.querySelectorAll('[data-nav]').forEach((element) => {
  element.addEventListener('click', () => {
    const target = element.dataset.nav;
    if (target) {
      window.location.href = target;
    }
  });
});

document.querySelectorAll('[data-logout]').forEach((element) => {
  element.addEventListener('click', () => {
    API.logout();
  });
});

document.querySelectorAll('form[data-prevent-submit="true"]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
  });
});
