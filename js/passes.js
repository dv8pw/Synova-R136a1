import { S as runtimeState } from './context.js';
import { Re as Vector2, ke as Color, is as ShaderMaterial, rp as ShaderPass, Ld as UnrealBloomPass, oce as edgeVertexSource, ace as edgeFragmentSource, R4 as finishVertexSource, lce as finishFragmentSource } from './renderer.js';
import { getActiveTheme } from './themes.js';

const bloomTintProperties = [
  'firstBloomMipTintColor',
  'secondBloomMipTintColor',
  'thirdBloomMipTintColor',
  'fourthBloomMipTintColor',
  'fifthBloomMipTintColor',
];

export function installImageEffects(theme = getActiveTheme()) {
  const frame = theme.postProcessing.frame;
  const glowPass = new UnrealBloomPass(new Vector2(runtimeState.window.w, runtimeState.window.h));
  const softGlow = theme.postProcessing.softGlow;
  Object.assign(glowPass, {
    name: 'Soft Glow',
    enabled: softGlow.enabled,
    strength: softGlow.strength,
    threshold: softGlow.threshold,
    radius: softGlow.radius,
  });
  applyBloomTintColors(glowPass, softGlow);
  const edgePass = new ShaderPass(new ShaderMaterial({
    vertexShader: edgeVertexSource,
    fragmentShader: edgeFragmentSource,
    uniforms: { tDiffuse: { value: null }, uSamples: { value: 8 } },
    defines: {
      EDGE_THRESHOLD_MIN: 0.00927,
      EDGE_THRESHOLD_MAX: 0.12371,
      SUBPIXEL_QUALITY: 0.8722,
    },
    name: 'Edge Surface',
  }));
  edgePass.name = 'Edge Pass';
  const finishPass = new ShaderPass(new ShaderMaterial({
    vertexShader: finishVertexSource,
    fragmentShader: finishFragmentSource,
    uniforms: {
      tDiffuse: { value: null },
      uEnabled: { value: frame.enabled },
      uChromaticAberration: { value: frame.chromaticAberrationEnabled },
      uVignette: { value: frame.vignetteEnabled },
      uNoise: { value: frame.noiseEnabled },
      uMaxDistort: { value: frame.chromaticAberrationMaximumDistortion },
      uBendAmount: { value: frame.chromaticAberrationBendAmount },
      uVignetteStrength: { value: frame.vignetteStrength },
      uVignetteInnerStrength: { value: frame.vignetteInnerStrength },
      uVignetteOuterStrength: { value: frame.vignetteOuterStrength },
      uVignetteColor: { value: new Color(frame.vignetteColor) },
      uNoiseStrength: { value: frame.noiseStrength },
    },
    name: 'Frame Finish Shader',
  }));
  finishPass.name = 'Frame Finish';

  runtimeState.WebGL.bloomPass = glowPass;
  runtimeState.WebGL.edgePass = edgePass;
  runtimeState.WebGL.compositePass = finishPass;
  runtimeState.WebGL.composerPasses.add(edgePass, 200);
  runtimeState.WebGL.composerPasses.add(glowPass, 202);
  glowPass.setSize(runtimeState.window.w * runtimeState.WebGL.renderer.getPixelRatio(),
    runtimeState.window.h * runtimeState.WebGL.renderer.getPixelRatio());
  runtimeState.WebGL.composerPasses.add(finishPass, 210);
  applyImageEffectsTheme(theme);
}

export function applyImageEffectsTheme(theme) {
  const webgl = runtimeState.WebGL;
  if (!webgl?.bloomPass || !webgl.compositePass) return;

  const softGlow = theme.postProcessing.softGlow;
  Object.assign(webgl.bloomPass, {
    enabled: softGlow.enabled,
    strength: softGlow.strength,
    threshold: softGlow.threshold,
    radius: softGlow.radius,
  });
  applyBloomTintColors(webgl.bloomPass, softGlow);
  const frame = theme.postProcessing.frame;
  const uniforms = webgl.compositePass.uniforms;
  uniforms.uEnabled.value = frame.enabled;
  uniforms.uChromaticAberration.value = frame.chromaticAberrationEnabled;
  uniforms.uMaxDistort.value = frame.chromaticAberrationMaximumDistortion;
  uniforms.uBendAmount.value = frame.chromaticAberrationBendAmount;
  uniforms.uVignette.value = frame.vignetteEnabled;
  uniforms.uNoise.value = frame.noiseEnabled;
  uniforms.uVignetteStrength.value = frame.vignetteStrength;
  uniforms.uVignetteInnerStrength.value = frame.vignetteInnerStrength;
  uniforms.uVignetteOuterStrength.value = frame.vignetteOuterStrength;
  uniforms.uVignetteColor.value.set(frame.vignetteColor);
  uniforms.uNoiseStrength.value = frame.noiseStrength;
}

function applyBloomTintColors(bloomPass, softGlow) {
  if (!bloomPass?.bloomTintColors) return;
  bloomTintProperties.forEach((propertyName, index) => {
    const tint = softGlow[propertyName];
    bloomPass.bloomTintColors[index].set(tint.x, tint.y, tint.z);
  });
}
