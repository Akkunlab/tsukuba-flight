// ブラウザで一通り動くかの確認（タイトル → 格納庫 → 音をつくる → 飛ぶ → やめる）。
import { expect, test } from '@playwright/test';

type TF = { debug: { errors: string[] }; state: () => { screen: string; phase: string | null; time: number } };
declare global {
  interface Window {
    __tf: TF;
  }
}

test('遊べる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/api\/|Failed to load resource|ERR_CONNECTION/.test(m.text())) errors.push(m.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => window.__tf?.state().screen === 'title', null, { timeout: 90_000 });
  await expect(page.locator('#generation')).toContainText('世代');

  await page.click('#btn-hangar');
  await expect(page.locator('#pick-vehicle .card')).not.toHaveCount(0);

  // 音をつくって乗せる
  await page.click('#btn-new-passenger');
  await page.fill('#ed-name', 'テストの音');
  await page.click('#ed-save');
  await expect(page.locator('#pick-passenger .card', { hasText: 'テストの音' })).toHaveClass(/selected/);

  // 乗り物を全部選んでみる（見た目のビルダーが壊れていないか）
  const n = await page.locator('#pick-vehicle .card').count();
  for (let i = 0; i < n; i++) await page.locator('#pick-vehicle .card').nth(i).click();
  await page.locator('#pick-vehicle .card', { hasText: 'ヘリコプター' }).click();

  await page.click('#btn-start');
  await page.waitForFunction(() => window.__tf.state().phase === 'flying', null, { timeout: 60_000 });
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__tf.state().time > 1.5, null, { timeout: 60_000 });
  await page.keyboard.up('w');
  await page.keyboard.press('c');

  await page.click('#btn-pause');
  await expect(page.locator('#pause')).toBeVisible();
  await page.click('#btn-quit');
  await page.waitForFunction(() => window.__tf.state().screen === 'hangar');

  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__tf.debug.errors)).toEqual([]);
});
