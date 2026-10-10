// Walk through the tour course and screenshot every page.
export default async ({ win, shot, step, log }) => {
  await win.waitForSelector('.course-card', { timeout: 15000 });
  await shot('01-dashboard');
  await win.click('.course-card');
  await win.waitForSelector('.chapter-row');
  await win.waitForTimeout(400);
  await shot('02-course');
  const pages = [
    ['w0-read', 1], ['w0-read', 2], ['w0-read', 3], ['w0-read', 4],
    ['w0-check', 1], ['w0-check', 2],
    ['w1-workshop', 1], ['w1-workshop', 2], ['w1-workshop', 3],
    ['w2-ai', 1], ['w2-ai', 2], ['w2-ai', 3],
  ];
  let n = 3;
  for (const [ch, p] of pages) {
    await step(`${ch}/${p}`, async () => {
      await win.evaluate(([c, i]) => { location.hash = `#/learn/vla-tour/${c}/${i}`; }, [ch, p]);
      await win.waitForSelector('.vt-article', { timeout: 15000 });
      await win.waitForTimeout(1800);
      const name = String(n++).padStart(2, '0');
      await shot(`${name}-${ch}-${p}-a`);
      const more = await win.evaluate(() => { const r = document.querySelector('.reader'); return r.scrollHeight > r.clientHeight + 100; });
      if (more) {
        await win.evaluate(() => { const r = document.querySelector('.reader'); r.scrollTop = r.clientHeight - 80; });
        await win.waitForTimeout(1200);
        await shot(`${name}-${ch}-${p}-b`);
        const more2 = await win.evaluate(() => { const r = document.querySelector('.reader'); return r.scrollHeight > r.scrollTop + 2 * r.clientHeight; });
        if (more2) {
          await win.evaluate(() => { const r = document.querySelector('.reader'); r.scrollTop += r.clientHeight - 80; });
          await win.waitForTimeout(1200);
          await shot(`${name}-${ch}-${p}-c`);
        }
      }
    });
  }
  log('done');
};
