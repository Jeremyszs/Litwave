// End-to-end checks in real Chrome with real mouse/touch/keyboard input, against a fake Litwave server (no hardware,
// no data files touched). Skips with a notice when no Chrome/Edge is installed (set CHROME_PATH to point at one).
//   node tests/check_e2e.mjs            run everything
//   node tests/check_e2e.mjs panels     run only tests whose name or file contains "panels"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, startServer } from './e2e/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const filter = (process.argv[2] || '').toLowerCase();
const browser = await launchBrowser();
if (!browser) { console.log('SKIP: no Chrome or Edge found (set CHROME_PATH). End-to-end checks not run.'); process.exit(0); }
const server = await startServer();

const files = fs.readdirSync(path.join(HERE, 'e2e', 'specs')).filter((f) => f.endsWith('.mjs')).sort();
let passed = 0, failed = 0;
for (const f of files) {
  const { tests } = await import(pathToFileURL(path.join(HERE, 'e2e', 'specs', f)).href);
  for (const t of tests) {
    const label = `${f.replace('.mjs', '')}: ${t.name}`;
    if (filter && !label.toLowerCase().includes(filter)) continue;
    server.reset();
    const t0 = Date.now();
    let page = null;
    try {
      page = await browser.newPage(t.viewport || {});
      page.base = server.url;
      await page.goto(t.path || '/');
      server.clearCalls();
      if (t.setup) await t.setup({ page, server });
      await t.run({ page, server });
      if (!t.allowErrors && page.errors.length) throw new Error('page logged errors: ' + page.errors.slice(0, 2).join(' | '));
      console.log(`PASS: ${label} (${Date.now() - t0} ms)`); passed++;
    } catch (e) {
      console.error(`FAIL: ${label} - ${e.message}`); failed++;
    } finally { if (page) await page.close(); }
  }
}
browser.close();
await server.close();
console.log(`\ne2e: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
