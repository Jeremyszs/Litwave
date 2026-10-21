import assert from 'node:assert';
import { sleep } from '../harness.mjs';

// Fixture song: "Demo Song.mp3", 200 s, one section "Verse" at 40 s linked to scene 1, playhead at 60 s.
const posts = (server, pred) => server.calls.filter((c) => c.body && pred(c.body, c));
const islandAlert = (page) => page.ev(`(() => { const t = document.querySelector('#island .a1'); const b = document.querySelector('#island .isl-act'); return { title: t && t.textContent, undo: !!b && !b.hidden, label: b && b.textContent, state: document.getElementById('island').dataset.state }; })()`);

export const tests = [
  {
    name: 'deleting a section offers Undo in the island; clicking it puts the section back',
    run: async ({ page, server }) => {
      await page.click('#sectionLane .del');
      await page.waitFor(`document.querySelector('#island .isl-act') && !document.querySelector('#island .isl-act').hidden`, 3000, 'Undo button');
      const a = await islandAlert(page);
      assert.strictEqual(a.title, 'Section deleted');
      assert.strictEqual(a.label, 'Undo');
      assert.strictEqual(posts(server, (b) => b.action === 'remove_marker' && b.id === 1).length, 1);
      server.clearCalls();
      await page.click('#island .isl-act');
      await sleep(300);
      const back = posts(server, (b) => b.action === 'add_marker');
      assert.strictEqual(back.length, 1, 'the marker is re-added once');
      assert.deepStrictEqual(back[0].body, { action: 'add_marker', name: 'Verse', time: 40, scene: 1 });
      await page.waitFor(`document.querySelector('#island .a1').textContent === 'Undone'`, 2000, '"Undone" confirmation');
      assert.strictEqual((await islandAlert(page)).undo, false, 'no second Undo button');
    },
  },
  {
    name: 'Ctrl+Z undoes the last delete, once',
    run: async ({ page, server }) => {
      await page.click('#sectionLane .del');
      await page.waitFor(`LW.undo.available`, 3000, 'undo to be available');
      server.clearCalls();
      await page.key('z', { modifiers: 2 }); // Ctrl
      await sleep(300);
      assert.strictEqual(posts(server, (b) => b.action === 'add_marker').length, 1);
      await page.key('z', { modifiers: 2 });
      await sleep(250);
      assert.strictEqual(posts(server, (b) => b.action === 'add_marker').length, 1, 'a second Ctrl+Z has nothing to undo');
    },
  },
  {
    name: 'clearing the song offers Undo that reloads it and returns the playhead',
    run: async ({ page, server }) => {
      await page.click('#btnClear');
      await page.waitFor(`document.querySelector('#island .isl-act') && !document.querySelector('#island .isl-act').hidden`, 3000, 'Undo button');
      assert.strictEqual((await islandAlert(page)).title, 'Track cleared');
      assert(posts(server, (b) => b.action === 'clear_track').length === 1);
      server.clearCalls();
      await page.click('#island .isl-act');
      await sleep(500);
      const order = server.calls.map((c) => (c.url === '/api/playlist/select' ? 'select' : c.body.action));
      assert.deepStrictEqual(order, ['select', 'seek'], `unexpected restore sequence: ${order}`);
      assert.deepStrictEqual(server.calls[0].body, { filename: 'Demo Song.mp3' });
      assert.strictEqual(server.calls[1].body.seconds, 60);
    },
  },
  {
    name: 'other alerts do not bump the Undo button off the island',
    run: async ({ page }) => {
      await page.click('#sectionLane .del');
      await page.waitFor(`LW.undo.available`, 3000, 'undo');
      await page.ev(`LW.alert({ icon: 'play', title: 'Remote · Play' }, 800)`);
      await sleep(300);
      const a = await islandAlert(page);
      assert.strictEqual(a.title, 'Section deleted', 'the Undo alert stays up');
      assert.strictEqual(a.undo, true);
    },
  },
  {
    name: 'Undo expires after its time and then does nothing',
    run: async ({ page, server }) => {
      await page.ev(`LW.undo.ttl = 600`);
      await page.click('#sectionLane .del');
      await page.waitFor(`LW.undo.available`, 3000, 'undo');
      await page.waitFor(`!LW.undo.available`, 3000, 'undo to expire');
      await page.waitFor(`document.querySelector('#island .isl-act').hidden`, 2000, 'button to go away');
      server.clearCalls();
      await page.key('z', { modifiers: 2 });
      await sleep(250);
      assert.strictEqual(server.calls.length, 0, 'an expired undo must not fire');
    },
  },
  {
    name: 'Ctrl+Z inside a text field is left to the field',
    run: async ({ page, server }) => {
      await page.click('#sectionLane .del');
      await page.waitFor(`LW.undo.available`, 3000, 'undo');
      await page.click('#inspTabs .tab[data-k="click"]'); await sleep(500);
      await page.click('#bpmInput');
      server.clearCalls();
      await page.key('z', { modifiers: 2 });
      await sleep(250);
      assert.strictEqual(posts(server, (b) => b.action === 'add_marker').length, 0);
      assert.strictEqual(await page.ev('LW.undo.available'), true, 'still available for later');
    },
  },
];
