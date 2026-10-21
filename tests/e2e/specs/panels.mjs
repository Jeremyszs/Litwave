import assert from 'node:assert';
import { sleep } from '../harness.mjs';

const geo = (page, id) => page.ev(`(() => { const p = document.getElementById(${JSON.stringify(id)}); const r = p.getBoundingClientRect();
  return { rect: [r.left, r.top, r.width, r.height].map(Math.round), parent: p.parentNode.id || p.parentNode.className, expanded: p.classList.contains('expanded'),
    inline: p.getAttribute('style') || '', placeholders: document.querySelectorAll('.panel-ph').length, dimmed: document.getElementById('main').classList.contains('has-expanded') }; })()`);

const sameRect = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);

export const tests = ['progPanel', 'lyricsPanel'].flatMap((id) => [
  {
    name: `${id} returns exactly where it was after expand and minimize`,
    run: async ({ page }) => {
      const before = await geo(page, id);
      await page.click(`[data-expand="${id}"]`);
      await page.waitFor(`document.getElementById('${id}').classList.contains('expanded')`);
      await sleep(1100);
      const open = await geo(page, id);
      assert(open.rect[2] > before.rect[2] && open.rect[3] > before.rect[3], 'panel should grow when expanded');
      await page.click(`#${id} [data-expand]`);
      await sleep(1600);
      const after = await geo(page, id);
      assert(sameRect(after.rect, before.rect), `panel moved: ${before.rect} -> ${after.rect}`);
      assert.strictEqual(after.expanded, false);
      assert.strictEqual(after.inline, '', `leftover inline style: ${after.inline}`);
      assert.strictEqual(after.placeholders, 0, 'placeholder left behind');
      assert.strictEqual(after.dimmed, false, 'rest of the page is still dimmed');
    },
  },
  {
    name: `${id} survives rapid expand / minimize / expand / minimize`,
    run: async ({ page }) => {
      const before = await geo(page, id);
      for (let i = 0; i < 2; i++) {
        await page.click(`[data-expand="${id}"], #${id} [data-expand]`);
        await sleep(150);
        await page.click(`#${id} [data-expand]`);
        await sleep(150);
      }
      await sleep(1800);
      const after = await geo(page, id);
      assert.strictEqual(after.placeholders, 0, 'placeholder left behind');
      assert.strictEqual(after.expanded, false);
      assert(sameRect(after.rect, before.rect), `panel moved: ${before.rect} -> ${after.rect}`);
    },
  },
  {
    name: `${id} Esc collapses it and it stays in place`,
    run: async ({ page }) => {
      const before = await geo(page, id);
      await page.click(`[data-expand="${id}"]`);
      await sleep(1000);
      await page.key('Escape');
      await sleep(1600);
      const after = await geo(page, id);
      assert(sameRect(after.rect, before.rect), `panel moved: ${before.rect} -> ${after.rect}`);
      assert.strictEqual(after.placeholders, 0);
    },
  },
]);
