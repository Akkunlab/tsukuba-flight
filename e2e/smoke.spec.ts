// ブラウザで開いて飛び始めるまで、エラーが出ないか。
import { expect, test } from '@playwright/test';

type TF = { debug: { errors: string[] }; state: () => { screen: string; phase: string | null; time: number } };
declare global {
  interface Window {
    __tf: TF;
  }
}

test('開いて、飛び始められる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__tf?.state().screen === 'title', null, { timeout: 90_000 });
  await page.click('#btn-hangar');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__tf.state().time > 1, null, { timeout: 90_000 });

  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__tf.debug.errors)).toEqual([]);
});
