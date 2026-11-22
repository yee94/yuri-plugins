const { Plugin, Registry, Style } = require('@opencode/plugin/gui');

const Theme = Registry.define('yuri.theme');
const Branding = Registry.define('yuri.branding');

const logo =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#8dafff"/></svg>';
const lightLogo =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#3155a0"/></svg>';

module.exports = Plugin.define({
  setup(ctx) {
    ctx.add(Theme, {
      id: 'hello-dark',
      title: 'Hello Dark',
      variant: 'dark',
      colors: { primary: { base: '#8dafff' }, surface: { background: '#151820' } },
    });
    ctx.add(Branding, {
      id: 'hello',
      title: 'Hello',
      logo: { svg: logo, lightSvg: lightLogo },
    });
    ctx.add(Style, '[data-yuri-logo] { border-radius: 12%; }');
  },
});
