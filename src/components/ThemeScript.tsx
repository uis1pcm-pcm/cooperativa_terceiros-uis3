export default function ThemeScript() {
  const code = `
  (function() {
    try {
      var ls = localStorage.getItem('theme');
      var mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var theme = ls === 'light' || ls === 'dark' ? ls : (mql ? 'dark' : 'light');
      if (theme === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    } catch(e) {}
  })();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} suppressHydrationWarning />;
}
