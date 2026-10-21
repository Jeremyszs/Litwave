import assert from 'node:assert';

// The Studio sidebar header is just the "Litwave" wordmark and the theme toggle. No logo tile sits beside the name.
export const tests = [
  {
    name: 'sidebar header text is exactly "Litwave"',
    run: async ({ page }) => {
      const text = await page.ev(`(document.querySelector('#sidebar .sb-brand b') || {}).textContent`);
      assert.strictEqual(text && text.trim(), 'Litwave', `header text was ${JSON.stringify(text)}`);
    },
  },
  {
    name: 'sidebar header has no logo icon beside the name',
    run: async ({ page }) => {
      const logo = await page.ev(`!!document.querySelector('#sidebar .sb-brand .logo')`);
      assert.strictEqual(logo, false, 'the .logo tile should be removed from the header');
      const extra = await page.ev(`[...document.querySelector('#sidebar .sb-brand').children].filter(e => e.id !== 'btnTheme').map(e => e.tagName + '.' + e.className)`);
      assert.deepStrictEqual(extra, ['B.'], `only the wordmark may sit beside the theme button, found ${JSON.stringify(extra)}`);
      const stray = await page.ev(`[...document.querySelectorAll('#sidebar .sb-brand svg')].filter(s => !s.closest('#btnTheme')).length`);
      assert.strictEqual(stray, 0, 'no SVG icon may appear in the header outside the theme button');
    },
  },
  {
    name: 'theme toggle in the sidebar header is present and switches the theme',
    run: async ({ page }) => {
      const present = await page.ev(`!!document.querySelector('#sidebar .sb-brand #btnTheme')`);
      assert.strictEqual(present, true, '#btnTheme should sit in the sidebar header');
      const before = await page.ev(`document.documentElement.dataset.theme`);
      await page.click('#btnTheme');
      await page.waitFor(`document.documentElement.dataset.theme && document.documentElement.dataset.theme !== '${before}'`, 2500, 'theme to change after clicking #btnTheme');
      const after = await page.ev(`document.documentElement.dataset.theme`);
      assert.notStrictEqual(after, before, 'clicking the theme button should change data-theme');
    },
  },
];
