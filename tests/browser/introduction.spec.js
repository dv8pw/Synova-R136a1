import { expect, test } from '@playwright/test';
import { ready, watchErrors } from './helpers.js';

const sentences = [
  'Ah, you found it!',
  '...a small place on the internet with my name on it.',
  'Maybe you meant to end up here.',
  'Maybe not.',
  'Either way, here you are.',
  "There isn't much here yet, and maybe that's alright.",
  'Take care out there.',
];
const samples = [2.5, 5, 11.5, 13.5, 16.5, 24.5, 31];

async function fixture(page, reducedMotion = false, waitForFonts = true) {
  await page.route('**/introduction-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main><h1 id="title-introduction"></h1></main>',
  }));
  await page.goto('/introduction-fixture', { waitUntil: waitForFonts ? 'load' : 'domcontentloaded' });
  await page.evaluate(async ({ reducedMotion, waitForFonts }) => {
    const { createTitleIntroduction } = await import('/js/title-introduction.js');
    const { dr: gsap } = await import('/js/renderer.js');
    gsap.ticker.remove(gsap.updateRoot);
    if (waitForFonts) await document.fonts.ready;
    window.introductionTest = createTitleIntroduction(document.querySelector('h1'), gsap, { reducedMotion });
    window.introductionTest.start(0);
  }, { reducedMotion, waitForFonts });
}

test('single-line fit refreshes after a delayed web-font load', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  let releaseFont;
  const fontGate = new Promise(resolve => { releaseFont = resolve; });
  await page.route('**/instrument-sans.woff2', async route => {
    await fontGate;
    await route.continue();
  });
  await fixture(page, false, false);
  await seek(page, 11.5);
  const fallbackSize = await page.locator('.introduction-line--single').evaluate(line => line.style.fontSize);
  releaseFont();
  await page.evaluate(() => document.fonts.ready);
  await seek(page, 11.5);
  const geometry = await page.locator('.introduction-line--single').evaluate(line => {
    const rect = line.getBoundingClientRect();
    const stage = document.querySelector('h1').getBoundingClientRect();
    return { left: rect.left, right: rect.right, stageLeft: stage.left, stageRight: stage.right, font: parseFloat(getComputedStyle(line).fontSize), inlineSize: line.style.fontSize, loaded: document.fonts.check('18px "Instrument Sans"') };
  });
  expect(geometry.loaded).toBe(true);
  expect(geometry.inlineSize).not.toBe(fallbackSize);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.stageLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.stageRight);
  expect(geometry.font).toBeGreaterThanOrEqual(18);
});

async function seek(page, seconds) {
  await page.evaluate(seconds => window.introductionTest.update(seconds), seconds);
}

async function visibleCharacters(page, lineIndex) {
  const scope = lineIndex === undefined ? page : page.locator('.introduction-line').nth(lineIndex);
  return scope.locator('.introduction-character').evaluateAll(characters => characters.filter(character => {
    let opacity = 1;
    for (let element = character; element; element = element.parentElement) opacity *= Number(getComputedStyle(element).opacity);
    return opacity > 0.01;
  }).map(character => character.textContent).join('').replaceAll('\u00a0', ' '));
}

test('introduction preserves copy, delay, reading sequence, pause, final exit and reset', async ({ page }) => {
  const errors = watchErrors(page);
  await fixture(page);
  await seek(page, 0.999);
  expect(await visibleCharacters(page)).toBe('');
  await seek(page, 1.1);
  const motionState = () => page.locator('.introduction-group, .introduction-line, .introduction-character').evaluateAll(elements => elements.map(element => element.getAttribute('style')));
  const duringReveal = await motionState();
  await page.waitForTimeout(300);
  expect(await motionState()).toEqual(duringReveal);
  for (const [index, duringPause, afterPause, prefix, continuation] of [
    [0, 1.6, 1.9, 'Ah,', ' you'],
    [4, 14.9, 15.45, 'Either way, ', 'here'],
    [5, 22.5, 23.2, "There isn't much here yet, ", 'and'],
  ]) {
    await seek(page, duringPause);
    expect(await visibleCharacters(page, index)).toBe(prefix);
    await seek(page, afterPause);
    expect(await visibleCharacters(page, index)).toContain(prefix + continuation);
  }
  for (let index = 0; index < sentences.length; index++) {
    await seek(page, samples[index]);
    expect(await visibleCharacters(page)).toContain(sentences[index]);
  }
  const paused = await visibleCharacters(page);
  await page.waitForTimeout(300);
  expect(await visibleCharacters(page)).toBe(paused);
  await seek(page, 38);
  expect(await visibleCharacters(page)).toBe('');
  await page.evaluate(() => { window.introductionTest.reset(); window.introductionTest.start(100); });
  await seek(page, 100.999);
  expect(await visibleCharacters(page)).toBe('');
  await seek(page, 102.5);
  expect(await visibleCharacters(page)).toBe(sentences[0]);
  expect(errors).toEqual([]);
});

test('long sentences and groups fit supported viewports with readable, non-selectable text', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = watchErrors(page);
  await fixture(page);
  for (const [width, height] of [[320,568], [390,844], [844,390], [1024,1366], [1280,720], [1920,960], [2560,1320], [3840,2040]]) {
    await page.setViewportSize({ width, height });
    for (const seconds of [5, 11.5, 16.5, 24.5]) {
      await seek(page, seconds);
      const geometry = await page.locator('h1').evaluate(heading => {
        const rects = [...heading.querySelectorAll('.introduction-character')].filter(character => {
          let opacity = 1;
          for (let element = character; element; element = element.parentElement) opacity *= Number(getComputedStyle(element).opacity);
          return opacity > 0.01;
        }).map(character => {
          const r = character.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        });
        const style = getComputedStyle(heading);
        return { rects, fontSize: parseFloat(style.fontSize), font: style.fontFamily, align: style.textAlign, selection: style.userSelect, scroll: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight };
      });
      expect(geometry.fontSize).toBeGreaterThanOrEqual(18);
      expect(geometry.font).toContain('Instrument Sans');
      expect(geometry.align).toBe('center');
      expect(geometry.selection).toBe('none');
      expect(geometry.scroll).toBeLessThanOrEqual(width);
      expect(geometry.rects.length).toBeGreaterThan(0);
      if (seconds === 11.5) {
        const sentence = await page.locator('.introduction-line').nth(2).evaluate(line => {
          const characters = [...line.querySelectorAll('.introduction-character')];
          return { firstTop: characters[0].getBoundingClientRect().top, lastTop: characters.at(-1).getBoundingClientRect().top, size: parseFloat(getComputedStyle(line).fontSize) };
        });
        expect(sentence.lastTop).toBeCloseTo(sentence.firstTop, 1);
        expect(sentence.size).toBeGreaterThanOrEqual(18);
      }
      for (const rect of geometry.rects) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.bottom).toBeLessThanOrEqual(height);
      }
      if (seconds === 16.5) await page.screenshot({ path: info.outputPath(`intro-group-${width}.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test('reduced motion reveals complete sentences without transforms or blur', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, true);
  const activeLines = () => page.locator('.introduction-line').evaluateAll(lines => lines.filter(line => Number(getComputedStyle(line).opacity) * Number(getComputedStyle(line.parentElement).opacity) > 0.01).map(line => line.textContent));
  await seek(page, 0.999);
  expect(await activeLines()).toEqual([]);
  await seek(page, 1.01);
  expect(await activeLines()).toEqual([sentences[0]]);
  await expect(page.locator('.introduction-character')).toHaveCount(0);
  expect(await page.locator('.introduction-line').evaluateAll(lines => lines.every(line => getComputedStyle(line).filter === 'none'))).toBe(true);
  for (let index = 0; index < samples.length; index++) {
    await seek(page, samples[index]);
    expect(await activeLines()).toEqual([sentences[index]]);
    const position = await page.locator('.introduction-line').nth(index).evaluate(line => {
      const bounds = line.getBoundingClientRect();
      const anchor = document.querySelector('h1').getBoundingClientRect();
      return { center: (bounds.top + bounds.bottom) / 2, anchor: anchor.top, top: bounds.top, bottom: bounds.bottom, viewport: innerHeight };
    });
    expect(position.center).toBeCloseTo(position.anchor, 1);
    expect(position.top).toBeGreaterThanOrEqual(0);
    expect(position.bottom).toBeLessThanOrEqual(position.viewport);
  }
  await seek(page, 38);
  expect(await activeLines()).toEqual([]);
});

test('real opening delays the introduction and replay resets it', async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    window.addEventListener('synova-r136a1:opening-complete', () => {
      window.introAtOpeningComplete = [...document.querySelectorAll('.introduction-character')].some(character => Number(getComputedStyle(character).opacity) > 0);
    });
  });
  await ready(page);
  await expect(page).toHaveTitle('Synova-R136a1');
  expect(await page.evaluate(() => window.introAtOpeningComplete)).toBe(false);
  await expect.poll(() => visibleCharacters(page)).toContain(sentences[0]);
  await page.screenshot({ path: info.outputPath('intro-scene.png') });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const suspended = await page.locator('#title-introduction').innerHTML();
  await page.waitForTimeout(400);
  expect(await page.locator('#title-introduction').innerHTML()).toBe(suspended);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => visibleCharacters(page)).toContain(sentences[1]);
  await page.evaluate(async () => { const { S } = await import('/js/context.js'); S.replayOpening(); });
  expect(await visibleCharacters(page)).toBe('');
  await expect(page.locator('#opening-reveal')).toHaveAttribute('data-state', 'complete');
  await expect.poll(() => visibleCharacters(page)).toContain(sentences[0]);
  expect(errors).toEqual([]);
});
