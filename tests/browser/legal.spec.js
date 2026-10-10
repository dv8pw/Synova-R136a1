import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers.js';

test('subtle legal links navigate to readable policy pages and back', async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#opening-reveal')).toHaveAttribute('data-state', 'complete');
  const links = page.getByRole('navigation', { name: 'Legal' });
  await expect(links).toBeVisible();
  const bounds = await links.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  for (const [label, path] of [['Privacy Policy', '/privacy/'], ['Terms of Service', '/terms/']]) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${path.split('/')[1]}.png`) });
    await page.getByRole('link', { name: 'Synova-R136a1' }).click();
    await expect(page.locator('#opening-reveal')).toHaveAttribute('data-state', 'complete');
  }
  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('User-agent: *');
  expect(errors).toEqual([]);
});
