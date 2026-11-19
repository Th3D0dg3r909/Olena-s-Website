const menuButton = document.querySelector('#menu-toggle');
const navigation = document.querySelector('#studio-nav');
const mobile = window.matchMedia('(max-width: 48rem)');
function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
}
menuButton.hidden = false;
document.documentElement.classList.add('nav-ready');
menuButton.addEventListener('click', () => {
  menuButton.setAttribute('aria-expanded', String(menuButton.getAttribute('aria-expanded') !== 'true'));
});
navigation.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobile.matches && menuButton.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menuButton.focus();
  }
});
mobile.addEventListener('change', closeMenu);
