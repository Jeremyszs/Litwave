import assert from 'node:assert';

export const tests = [
  {
    name: 'phone-remote sheet draws its QR code locally (no outside service) and it decodes to the address',
    run: async ({ page, server }) => {
      await page.click('#tbRemote');
      await page.waitFor(`document.querySelector('#sheetRemote.open')`, 3000, 'remote sheet');
      await page.waitFor(`document.querySelector('#qrBox svg')`, 3000, 'QR code to be drawn');
      const url = await page.ev(`document.querySelector('#remoteUrl').value`);
      assert.strictEqual(url, 'http://192.0.2.10:8080/remote', 'address comes from /api/remote-info');
      assert.strictEqual(await page.count('#sheetRemote img'), 0, 'no <img> pointing at an outside QR service');
      const external = await page.ev(`performance.getEntriesByType('resource').map(r => r.name).filter(n => !n.startsWith(location.origin))`);
      assert.deepStrictEqual(external, [], 'the page must not fetch anything from outside');
      // Chrome can read QR codes itself on some platforms; when it can, the code must say the address.
      const decoded = await page.ev(`(async () => {
        if (!('BarcodeDetector' in window)) return 'unsupported';
        const svg = document.querySelector('#qrBox svg');
        const xml = new XMLSerializer().serializeToString(svg).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"');
        const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); await img.decode();
        const c = document.createElement('canvas'); c.width = c.height = 400; c.getContext('2d').drawImage(img, 0, 0);
        const found = await new BarcodeDetector({ formats: ['qr_code'] }).detect(c);
        return found.length ? found[0].rawValue : 'none';
      })()`);
      if (decoded === 'unsupported') console.log('      (BarcodeDetector not available in this Chrome: decode check skipped)');
      else assert.strictEqual(decoded, url, 'scanned QR code must contain the remote address');
    },
  },
  {
    name: 'phone-remote sheet shows the address even when the code cannot be drawn',
    setup: async ({ page }) => { await page.ev(`window.qrcode = undefined`); },
    run: async ({ page }) => {
      await page.click('#tbRemote');
      await page.waitFor(`document.querySelector('#sheetRemote.open') && document.querySelector('#remoteUrl').value`, 3000, 'address');
      assert.strictEqual(await page.count('#qrBox svg'), 0);
    },
  },
];
