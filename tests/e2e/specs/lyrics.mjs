import assert from 'node:assert';

// Fixture lyrics: line n (1-based) starts at 16 + 15 * (n - 1) seconds.
export const tests = [
  {
    name: 'clicking a lyric line seeks to that line, not to 0:00',
    run: async ({ page, server }) => {
      await page.click('#lyrics .lyr-line:nth-child(4)');
      await page.waitFor(`true`, 50);
      await new Promise((r) => setTimeout(r, 250));
      const seek = server.calls.find((c) => c.body && c.body.action === 'seek');
      assert(seek, 'a seek request should be sent');
      assert.strictEqual(seek.body.seconds, 61, `expected the line time (61 s) in "seconds", got ${JSON.stringify(seek.body)}`);
    },
  },
];
