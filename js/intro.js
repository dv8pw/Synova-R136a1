import { dr as gsap } from './renderer.js';

export function composeEntranceMotion(stageGraph) {
  gsap.matchMedia().add({
    isDesktop: '(min-width: 1024px)', isMobile: '(max-width: 1023px)',
  }, ({ conditions: layoutFlags }) => {
    const wideViewport = layoutFlags.isDesktop;
    stageGraph.cameras.camera1._position.set(0, wideViewport ? 3.18 : 2.377, wideViewport ? 16.767 : 11.01);
    const motionSequence = gsap.timeline({ paused: true, defaults: { duration: 3.91, ease: 'power2.out' } });
    stageGraph.introAnimation = motionSequence;
    motionSequence.fromTo(stageGraph.components.particles.mesh.position, { y: -4.03, z: wideViewport ? 8.2 : 7.27 }, { y: 0, z: 0, delay: wideViewport ? 0.579 : 0.489 }, 0)
      .fromTo(stageGraph.components.orb.position, { y: -3.8, z: wideViewport ? 7.67 : 6.85 }, { y: 0, z: 0, delay: wideViewport ? 0.607 : 0.49 }, 0)
      .fromTo(stageGraph.components.flares.mesh.position, { y: -4.07, z: wideViewport ? 7.99 : 7.14 }, { y: 0, z: 0, delay: wideViewport ? 0.62 : 0.514 }, 0)
      .fromTo(stageGraph.components.particles.mesh.rotation, { x: wideViewport ? 2.06 : 1.522 }, { x: 0 }, '<+0.2')
      .fromTo(stageGraph.components.orb.rotation, { x: wideViewport ? 2.01 : 1.646 }, { x: 0 }, '<')
      .fromTo(stageGraph.components.flares.positionSim.uniforms.uIntroAnimation, { value: wideViewport ? 4.14 : 2.433 }, { value: 0.97, duration: 2.88 }, '<');
    motionSequence.totalProgress(stageGraph.entranceProgress ?? 0).pause();
    return () => motionSequence.kill();
  });
}
