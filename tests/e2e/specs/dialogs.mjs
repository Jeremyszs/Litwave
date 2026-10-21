import assert from 'node:assert';
import { sleep } from '../harness.mjs';

const isOpen = (page, id) => page.ev(`!!document.querySelector('#${id}.open')`);

export const tests = [
  {
    name: 'Esc closes a dialog while its text field has focus',
    run: async ({ page }) => {
      await page.key('b');
      await page.waitFor(`document.querySelector('#dlgBookmark.open')`, 3000, 'bookmark dialog');
      await page.waitFor(`document.activeElement && document.activeElement.id === 'bmName'`, 2000, 'name field to take focus');
      await page.key('Escape');
      await page.waitFor(`!document.querySelector('#dlgBookmark.open')`, 2000, 'dialog to close');
    },
  },
  {
    name: 'Esc inside a text field with nothing open does not rewind the song',
    run: async ({ page, server }) => {
      await page.click('#inspTabs .tab[data-k="click"]'); await sleep(500);
      await page.click('#bpmInput');
      server.clearCalls();
      await page.key('Escape'); await sleep(250);
      assert(!server.calls.some((c) => c.body && c.body.action === 'seek'), 'Escape in a field must not seek');
    },
  },
  {
    name: 'clicking the dim area closes dialogs and sheets',
    run: async ({ page }) => {
      for (const [id, open] of [['dlgBookmark', `LW.markers.openDialog()`], ['dlgNewSetlist', `document.querySelector('#sbNewSetlist').click()`], ['sheetPrefs', `LW.openSheet('prefs')`]]) {
        await page.ev(open);
        await page.waitFor(`document.querySelector('#${id}.open')`, 3000, id + ' to open');
        await page.clickAt(30, 450);
        await page.waitFor(`!document.querySelector('#${id}.open')`, 2000, id + ' to close on dim-area click');
      }
    },
  },
  {
    name: 'dim-area click with a dialog over a sheet closes only the dialog',
    run: async ({ page }) => {
      await page.ev(`LW.openSheet('setlist')`); await sleep(500);
      await page.click('#slDelete'); await sleep(500);
      assert(await isOpen(page, 'dlgConfirm') && await isOpen(page, 'sheetSetlist'), 'both layers should be open');
      await page.clickAt(30, 450); await sleep(500);
      assert.strictEqual(await isOpen(page, 'dlgConfirm'), false);
      assert.strictEqual(await isOpen(page, 'sheetSetlist'), true, 'the sheet underneath must stay open');
    },
  },
];
