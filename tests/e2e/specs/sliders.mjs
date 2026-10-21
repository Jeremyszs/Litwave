import assert from 'node:assert';
import { sleep } from '../harness.mjs';

export const tests = [
  {
    name: 'desktop drone volume/cutoff post once on release, not while dragging',
    run: async ({ page, server }) => {
      await page.ev(`LW.openSheet('drone')`); await sleep(600);
      for (const [sel, label, action, key] of [['#droneVol', '#droneVolV', 'set_volume', 'volume'], ['#droneCut', '#droneCutV', 'set_cutoff', 'cutoff']]) {
        server.clearCalls();
        const drag = await page.dragHold(sel, 0.2, 0.8, { steps: 8 });
        assert.strictEqual(server.calls.length, 0, `${action} must not post while dragging (got ${server.calls.length})`);
        assert.notStrictEqual((await page.text(label)).trim(), '', 'readout still updates live');
        await drag.release(); await sleep(250);
        const posts = server.calls.filter((c) => c.url === '/api/drone-pad');
        assert.strictEqual(posts.length, 1, `${action} should post once on release (got ${posts.length})`);
        assert.strictEqual(posts[0].body.action, action);
        assert(posts[0].body[key] > 60, 'posted the released value');
      }
    },
  },
  {
    name: 'phone drone volume posts once on release, not while dragging',
    viewport: { width: 390, height: 844, mobile: true }, path: '/remote',
    run: async ({ page, server }) => {
      server.clearCalls();
      const r = await page.ev(`(() => { const r = document.querySelector('#droneVol').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; })()`);
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.w * 0.2, y: r.y, id: 1 }] });
      for (let i = 1; i <= 8; i++) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.w * (0.2 + 0.08 * i), y: r.y, id: 1 }] }); await sleep(30); }
      assert.strictEqual(server.calls.length, 0, 'no posts while dragging');
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250);
      const posts = server.calls.filter((c) => c.url === '/api/drone-pad');
      assert.strictEqual(posts.length, 1);
      assert.strictEqual(posts[0].body.action, 'set_volume');
    },
  },
  {
    name: 'a mixer fader drag still streams updates; only the drone sliders wait for release',
    run: async ({ page, server }) => {
      await page.drag('#fdTrack', 0.2, 0.7, { vertical: true, steps: 6 }); await sleep(250);
      const posts = server.calls.filter((c) => c.url === '/api/mixer' && c.body.track_volume !== undefined);
      assert(posts.length >= 3, `expected several streamed updates, got ${posts.length}`);
    },
  },
  {
    name: 'phone seek bar: a tap sends one seek and a slow drag is throttled',
    viewport: { width: 390, height: 844, mobile: true }, path: '/remote',
    run: async ({ page, server }) => {
      await page.tap('#tabs .tab[data-k="song"]'); await sleep(800);
      server.clearCalls();
      await page.tap('#seek', 0.5, 0.5); await sleep(300);
      const taps = server.calls.filter((c) => c.body && c.body.action === 'seek');
      assert.strictEqual(taps.length, 1, `a tap should send one seek (got ${taps.length})`);
      server.clearCalls();
      await page.touchDrag('#seek', 0.2, 0.8, { steps: 20 }); await sleep(300);
      const seeks = server.calls.filter((c) => c.body && c.body.action === 'seek');
      assert(seeks.length >= 2 && seeks.length <= 12, `drag seeks should be throttled (got ${seeks.length})`);
    },
  },
];
