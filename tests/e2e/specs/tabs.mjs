import assert from 'node:assert';
import { sleep } from '../harness.mjs';

// Every segmented control / tab bar must switch on a real click (mouse) or tap (touch).
// A bar that captures the pointer on press retargets the click to itself and silently stops selecting.
async function sweep(page, bars, pick, closeSheet) {
  for (const [bar, prep] of bars) {
    if (prep) { await page.waitFor(`!document.querySelector('.sheet.open, .sheet.closing')`, 3000, 'previous sheet to finish closing'); await page.ev(prep); await sleep(700); }
    const keys = await page.ev(`[...document.querySelectorAll('${bar} .tab')].map(t => t.dataset.k)`);
    assert(keys.length >= 2, `${bar} should have tabs`);
    for (const k of keys.slice().reverse()) {
      await pick(`${bar} .tab[data-k="${k}"]`);
      await page.waitFor(`(document.querySelector('${bar} .tab.on') || {dataset:{}}).dataset.k === '${k}'`, 2500, `${bar} to select ${k}`);
    }
    if (prep) { await closeSheet(); await sleep(450); }
  }
}

export const tests = [
  {
    name: 'desktop tab bars switch on a real mouse click',
    run: async ({ page }) => sweep(page, [
      ['#inspTabs'], ['#voicingSeg'],
      ['#warmthMode', `document.querySelector('#inspTabs .tab[data-k="eq"]').click()`],
      ['#prefTheme', `LW.openSheet('prefs')`], ['#earTabs', `LW.openSheet('ear')`], ['#setlistTabs', `LW.openSheet('setlist')`],
    ], (s) => page.click(s), () => page.key('Escape')),
  },
  {
    name: 'phone tab bars switch on a real touch tap',
    viewport: { width: 390, height: 844, mobile: true }, path: '/remote',
    run: async ({ page }) => sweep(page, [
      ['#tabs'],
      ['#slTabs', `LW.R.sheets.openSetlist('setlist')`], ['#earTabs', `LW.R.sheets.openEar()`],
    ], (s) => page.tap(s), () => page.tap('.sheet.open [data-close]')),
  },
  {
    name: 'phone bottom tab bar moves the pages',
    viewport: { width: 390, height: 844, mobile: true }, path: '/remote',
    run: async ({ page }) => {
      for (const [k, title] of [['pads', 'Pads'], ['mix', 'Mix'], ['parts', 'Parts'], ['song', 'Song'], ['stage', 'Stage']]) {
        await page.tap(`#tabs .tab[data-k="${k}"]`);
        await page.waitFor(`document.querySelector('#pageTitle').textContent.trim() === '${title}'`, 2500, `page ${title}`);
      }
    },
  },
  {
    name: 'FX bank tab sends the bank to the server',
    run: async ({ page, server }) => {
      await page.ev(`LW.openSheet('fxpads')`); await sleep(600);
      await page.click('#fxBanks .tab[data-k="B"]');
      await sleep(250);
      assert(server.calls.some((c) => c.url === '/api/fx-pads' && c.body.action === 'bank' && c.body.bank === 'B'), 'bank B was not sent');
    },
  },
];
