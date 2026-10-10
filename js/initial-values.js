import { defaultTheme, getSceneThemeValues } from './themes.js';

const sceneTuning = {
  "LandingOrb": {
    "Landing Orb": {
      "uniforms": {
        "uDebugClouds": false,
        "uCloudNoiseSpeed": 0.4070267048
      },
      "material": {},
      "visible": true
    },
    "LandingOrbParticles": {
      "material": {},
      "simulation": {
        "uniforms": {
          "uCurlSize": 0.2728344877,
          "uCurlNoiseSpeed": 3.7655727464,
          "uCurlStrength": 0.0881673746,
          "uLerpSpeed": 0.2039466186,
          "uCurl": true,
          "uRadius": 2.9182,
          "uFriction": 0,
          "uDecay": 0.3838008649,
          "uShapeThreshold": 0.2451,
          "uAmplitude": {
            "x": 0.1368727647,
            "y": 0.1209467106
          },
          "uRoughness": 0.6683875372,
          "uDetail": 0.501,
          "uFrequency": {
            "x": 7.7338357338,
            "y": 9.9713
          },
          "uCurlNoisePersistence": 0.1630596834,
          "uNoiseTranslation": {
            "x": 109.1751363226,
            "y": 101.2796372943,
            "z": 95.5524544697
          },
          "uDecay2": 0.4050798268,
          "uLerpSpeed2": 0.3803295799,
          "uFluidStrength": 0.096
        }
      },
      "visible": true,
      "uniforms": {
        "uParticleSize": 0.3604,
        "uScaleRange": {
          "y": 1.162
        }
      }
    },
    "Cameras / Settings": {
      "cameraPivotStrength": 0,
      "cameraPivotOffset": 17.79,
      "cameraPivotAngle": {
        "x": 0.2068718017,
        "y": 0.1149630924
      },
      "cameraYTranslate": 0
    },
    "Background": {
      "uniforms": {},
      "visible": true,
      "material": {}
    },
    "LandingOrbFlareParticles": {
      "material": {},
      "simulation": {
        "uniforms": {
          "uDecay": 0.13481,
          "uLerpSpeed": 0.1612029762,
          "uFluidStrength": 0.0309
        }
      },
      "visible": true,
      "uniforms": {
        "uParticleSize": 0.307,
        "uScaleRange": {
          "y": 1.239
        },
        "uCenterFade": {
          "x": 2.91,
          "y": 3.323
        }
      }
    }
  },
  "Global WebGL": {
    "Fluid Sim": {
      "simulation": {
        "mouseRadius": 0.1141709424,
        "curlStrength": 0.380147558,
        "dissipation": 0.0532164591,
        "clearValue": 0,
        "viscosity": 0.4798373108,
        "pressure": 0.97158
      },
      "fluid": {
        "force": 30.4,
        "forceClamp": 667.464,
        "iterations": 1.91
      }
    },
    "Post FX": {
      "noise": {}
    }
  }
};

mergeValues(sceneTuning, getSceneThemeValues(defaultTheme));

export default sceneTuning;

function mergeValues(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeValues(target[key] || {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
