// The reference's reading cadence, in seconds. Only the opening delay is adapted.
export const INTRODUCTION_DELAY_SECONDS = 1;
export const INTRODUCTION_BEATS = [
  { group: 0, parts: [{ text: 'Ah,', pause: 0.7 }, { text: ' you found it!' }], hold: 1.75 },
  { group: 0, text: '...a small place on the internet with my name on it.', hold: 3.8, exit: 1.2, gap: 1 },
  { group: 1, text: 'Maybe you meant to end up here.', hold: 1.8, singleLine: true },
  { group: 1, text: 'Maybe not.', hold: 1.4 },
  { group: 1, parts: [{ text: 'Either way, ', pause: 0.85 }, { text: 'here you are.' }], hold: 3.2, exit: 1.2, gap: 1 },
  { group: 2, parts: [{ text: "There isn't much here yet, ", pause: 1.7 }, { text: "and maybe that's alright.", breakBefore: true }], hold: 3.5, exit: 1.2, gap: 1 },
  { group: 3, text: 'Take care out there.', hold: 4.5, exit: 1.5, final: true },
];
const CHARACTER_SECONDS = 0.015;
const partsOf = beat => beat.parts ?? [{ text: beat.text }];
const textOf = beat => partsOf(beat).map(part => part.text).join('');
const readingDuration = beat => partsOf(beat).reduce((sum, part) =>
  sum + [...part.text].length * CHARACTER_SECONDS + (part.pause ?? 0), 0);
export const INTRODUCTION_DURATION_SECONDS = INTRODUCTION_DELAY_SECONDS +
  INTRODUCTION_BEATS.reduce((sum, beat) => sum + readingDuration(beat) + beat.hold +
    (beat.exit ?? 0) + (beat.gap ?? 0), 0);

// All motion is sought explicitly from the scene clock. No ticker, timers or
// CSS transitions can advance the text while the scene is suspended.
export function createTitleIntroduction(stage, gsap, { reducedMotion = false } = {}) {
  stage.replaceChildren();
  stage.classList.toggle('introduction-reduced', reducedMotion);
  const accessible = document.createElement('span');
  accessible.className = 'introduction-accessible';
  accessible.textContent = INTRODUCTION_BEATS.map(textOf).join(' ');
  stage.append(accessible);
  const timeline = gsap.timeline({ paused: true });
  const groups = [];
  let cursor = INTRODUCTION_DELAY_SECONDS;
  let startedAt = null;
  let currentSeconds = 0;
  let geometryDirty = true;
  // Cache geometry between resizes and the initial web-font swap.
  document.fonts.addEventListener('loadingdone', () => { geometryDirty = true; });
  const resizeObserver = new ResizeObserver(() => { geometryDirty = true; });
  resizeObserver.observe(stage);
  window.addEventListener('resize', () => { geometryDirty = true; });
  INTRODUCTION_BEATS.forEach((beat, beatIndex) => {
    let group = groups[beat.group];
    if (!group) {
      const element = document.createElement('span');
      element.className = 'introduction-group';
      element.setAttribute('aria-hidden', 'true');
      stage.append(element);
      group = { element, lines: [], opacity: 0, extent: 0 };
      groups[beat.group] = group;
      timeline.set(group, { opacity: 1 }, cursor);
    }
    const element = document.createElement('span');
    element.className = 'introduction-line';
    if (beat.singleLine) element.classList.add('introduction-line--single');
    const line = { element, start: cursor, beatIndex, singleLine: beat.singleLine };
    group.lines.push(line);
    group.element.append(element);
    if (reducedMotion) {
      partsOf(beat).forEach(part => {
        if (part.breakBefore) element.append(document.createElement('br'));
        element.append(document.createTextNode(part.text));
      });
    } else {
      let offset = 0;
      partsOf(beat).forEach(part => {
        if (part.breakBefore) element.append(document.createElement('br'));
        const pieces = part.text.match(/\s+|\S+/g) ?? [];
        pieces.forEach(piece => {
          const word = document.createElement('span');
          if (!/^\s+$/.test(piece)) word.className = 'introduction-word';
          [...piece].forEach(character => {
            const letter = document.createElement('span');
            letter.className = 'introduction-character';
            // Nonbreaking spaces preserve the reference's word spacing while
            // the whitespace wrapper still permits a break between words.
            letter.textContent = character === ' ' ? '\u00a0' : character;
            word.append(letter);
            timeline.fromTo(letter, { opacity: 0, y: 1, filter: 'blur(0.6px)' },
              { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.25, ease: 'power1.out', immediateRender: true }, cursor + offset);
            offset += CHARACTER_SECONDS;
          });
          element.append(word);
        });
        offset += part.pause ?? 0;
      });
    }
    const count = group.lines.length;
    if (count === 1 || reducedMotion) timeline.set(group, { extent: count }, cursor);
    else timeline.to(group, { extent: count, duration: 0.52, ease: 'power2.out' }, cursor);
    cursor += readingDuration(beat) + beat.hold;
    if (beat.exit) {
      group.exitStart = cursor;
      group.exitDuration = beat.exit;
      timeline.to(group, { opacity: 0, duration: beat.exit, ease: 'power1.inOut' }, cursor);
      cursor += beat.exit + (beat.gap ?? 0);
    }
  });

  function render() {
    if (geometryDirty) {
      const baseSize = parseFloat(getComputedStyle(stage).fontSize);
      groups.forEach(group => {
        group.lines.filter(line => line.singleLine).forEach(({ element }) => {
          element.style.fontSize = 'inherit';
          const size = Math.max(18, Math.min(baseSize, baseSize * (stage.clientWidth - 1) / element.scrollWidth));
          element.style.fontSize = `${size}px`;
        });
        group.heights = group.lines.map(line => line.element.getBoundingClientRect().height);
        group.gap = parseFloat(getComputedStyle(group.element).rowGap) || 0;
      });
      geometryDirty = false;
    }
    groups.forEach(group => {
      const activeIndex = group.lines.findLastIndex(line => currentSeconds >= line.start);
      if (reducedMotion) {
        group.element.style.transform = 'none';
        group.element.style.opacity = String(group.opacity);
        group.lines.forEach((line, index) => {
          line.element.style.opacity = index === activeIndex ? '1' : '0';
          line.element.style.filter = 'none';
        });
        return;
      }
      const { heights, gap } = group;
      const extent = group.extent;
      const count = Math.floor(extent);
      const fraction = extent - count;
      let visibleHeight = heights.slice(0, count).reduce((sum, height) => sum + height, 0) + Math.max(0, count - 1) * gap;
      if (fraction > 0) visibleHeight += fraction * (heights[count] + (count ? gap : 0));
      group.element.style.transform = `translateY(${-visibleHeight / 2}px)`;
      group.element.style.opacity = String(group.opacity);
      group.lines.forEach((line, index) => {
        let opacity = index <= activeIndex ? 1 : 0;
        let blur = 0;
        if (index < activeIndex) {
          const age = activeIndex - index;
          const ageSeconds = currentSeconds - group.lines[index + 1].start;
          const ageFade = Math.min(1, ageSeconds / 0.52);
          opacity = 1 - 0.66 * ageFade;
          blur = 0.9 * ageFade;
          if (age >= 2) {
            const secondAge = Math.min(1, (currentSeconds - group.lines[index + 2].start) / 0.52);
            opacity = Math.min(opacity, 0.34 - 0.22 * secondAge);
            blur = Math.max(blur, 0.9 + 0.6 * secondAge);
          }
          opacity *= 1 - Math.min(1, Math.max(0, ageSeconds - 0.8) / 8);
          blur += Math.min(1, Math.max(0, ageSeconds - 0.8) / 8) * (2 - blur);
        }
        line.element.style.opacity = String(opacity);
        line.element.style.filter = reducedMotion ? 'none' : `blur(${blur + (1 - group.opacity) * 2}px)`;
      });
    });
  }
  function reset() {
    startedAt = null;
    currentSeconds = 0;
    timeline.totalTime(0, true).pause();
    render();
  }
  function update(seconds) {
    const next = startedAt === null ? 0 : Math.min(INTRODUCTION_DURATION_SECONDS, Math.max(0, seconds - startedAt));
    if (next === currentSeconds && !geometryDirty) return;
    currentSeconds = next;
    timeline.totalTime(currentSeconds, true).pause();
    render();
  }
  reset();
  return {
    reset,
    start(seconds) { reset(); startedAt = seconds; },
    update,
  };
}
