/**
 * Plain pass-through. The y-flip that reconciles the top-left texture origin
 * with the bottom-left framebuffer origin is applied once, where the develop
 * pass samples the source image — doing it here instead would flip again on
 * every intermediate pass and cancel itself out whenever the detail passes run.
 */
export const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * The develop pass. Input is linear scene-referred RGB straight from LibRaw;
 * output is display-encoded sRGB. Order matters and mirrors the camera:
 * white balance and dynamic-range compensation act on scene light, the film
 * simulation LUT maps scene -> look, and the tone/colour trims shape the result.
 */
export const DEVELOP_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler3D uLut;
uniform bool  uHasLut;
uniform float uLutSize;

uniform float uExposure;       // stops
uniform float uWbRed;          // multipliers, 1.0 = neutral
uniform float uWbBlue;
uniform float uDrStops;        // log2(DR/100): 0, 1, 2
uniform float uHighlight;      // -2..+4  (camera steps)
uniform float uShadow;
uniform float uColor;          // -4..+4
uniform float uMonoWeights;    // >0 selects the monochrome path
uniform vec3  uMonoMix;        // channel mixer for the mono filter
uniform vec3  uToneTint;       // sepia / toning tint, vec3(1) = neutral
uniform float uColorChrome;    // 0..1
uniform float uColorChromeBlue;// 0..1
uniform float uGrain;          // 0..1
uniform float uGrainSize;      // px
uniform vec2  uResolution;
uniform float uSeed;
uniform vec2  uCropOrigin;   // active area, normalised texture coords
uniform vec2  uCropSize;

// ---- helpers --------------------------------------------------------------

vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 srgbDecode(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Filmic shoulder used for the DR modes: compresses highlights while leaving
// the lower mids essentially untouched, which is what DR200/400 do in-camera.
vec3 shoulder(vec3 x, float strength) {
  if (strength <= 0.0) return x;
  float k = 1.0 + strength;
  return x / (1.0 + (x / k) * strength) ;
}

// Highlight / Shadow trims. Fuji's controls are one-sided: Highlight only bends
// the upper half of the curve, Shadow only the lower, both centred so that 0
// is a no-op.
vec3 applyHighlight(vec3 c, float amount) {
  if (abs(amount) < 0.001) return c;
  float a = amount * 0.18;
  vec3 w = smoothstep(vec3(0.35), vec3(1.0), c);   // upper-range weight
  vec3 lifted = c + a * w * (1.0 - c);
  return mix(c, lifted, 1.0);
}

vec3 applyShadow(vec3 c, float amount) {
  if (abs(amount) < 0.001) return c;
  float a = amount * 0.18;
  vec3 w = 1.0 - smoothstep(vec3(0.0), vec3(0.65), c); // lower-range weight
  vec3 lifted = c - a * w * c;
  return clamp(lifted, 0.0, 1.0);
}

vec3 sampleLut(vec3 c) {
  // Tetrahedral-quality sampling comes free from hardware trilinear filtering
  // once we inset by half a texel on each end.
  float s = uLutSize;
  vec3 uvw = clamp(c, 0.0, 1.0) * ((s - 1.0) / s) + (0.5 / s);
  return texture(uLut, uvw).rgb;
}

// Cheap hash for grain — deterministic per pixel so the render is stable.
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  // Two corrections in one lookup: crop away the masked sensor border, and
  // flip y because LibRaw's buffer is top-down while the framebuffer is
  // bottom-up. Everything downstream stays in cropped canvas space.
  vec2 src = uCropOrigin + vec2(vUv.x, 1.0 - vUv.y) * uCropSize;
  vec3 c = texture(uImage, src).rgb;

  // --- scene-referred stage -------------------------------------------------
  c *= exp2(uExposure);
  c.r *= uWbRed;
  c.b *= uWbBlue;
  c = max(c, 0.0);

  // Dynamic range.
  //
  // DR200/400 underexpose the sensor by 1/2 stops at capture to buy highlight
  // headroom. LibRaw then normalises the raw to sensor saturation, which undoes
  // exactly that offset — so the decoded midtones arrive log2(DR/100) stops too
  // bright and we have to put them back before shaping the highlights.
  //
  // Measured, not guessed: sweeping exposure against the camera's own JPEG on
  // DR200 frames puts the L* bias at zero at -1.00 stops. See
  // tools/ground-truth.mjs.
  // The camera does not simply drop a stop, it lifts the midtones part of the
  // way back while leaving the highlights compressed. Sweeping exposure against
  // the camera JPEG on DR200 frames zeroes the L* bias at -2/3 of a stop, i.e.
  // a full stop down plus a third of a stop of midtone lift per DR step.
  if (uDrStops > 0.0) {
    c *= exp2(-uDrStops * 0.667);
    c = shoulder(c, uDrStops * 0.5);
  }

  // --- look stage -----------------------------------------------------------
  // LUTs are authored against display-encoded input, so encode first.
  vec3 disp = srgbEncode(c);
  if (uHasLut) disp = sampleLut(disp);

  // --- trims ----------------------------------------------------------------
  disp = applyHighlight(disp, uHighlight);
  disp = applyShadow(disp, uShadow);

  if (uMonoWeights > 0.0) {
    // Monochrome family: mix channels through the filter, then tone.
    vec3 lin = srgbDecode(disp);
    float g = dot(lin, uMonoMix) / max(uMonoMix.r + uMonoMix.g + uMonoMix.b, 1e-4);
    disp = srgbEncode(vec3(g) * uToneTint);
  } else {
    float l = luma(disp);
    // Color: saturation trim, gentle so ±4 stays usable.
    disp = clamp(mix(vec3(l), disp, 1.0 + uColor * 0.14), 0.0, 1.0);

    // Color Chrome deepens already-saturated colours without touching neutrals.
    if (uColorChrome > 0.0) {
      float sat = length(disp - vec3(l));
      float w = smoothstep(0.10, 0.45, sat) * uColorChrome;
      disp = clamp(mix(disp, mix(vec3(l), disp, 1.28), w), 0.0, 1.0);
    }
    if (uColorChromeBlue > 0.0) {
      float blueness = clamp(disp.b - max(disp.r, disp.g), 0.0, 1.0);
      float w = smoothstep(0.02, 0.30, blueness) * uColorChromeBlue;
      disp = clamp(mix(disp, mix(vec3(l), disp, 1.35), w), 0.0, 1.0);
    }
  }

  // --- grain ----------------------------------------------------------------
  if (uGrain > 0.0) {
    vec2 gp = floor(vUv * uResolution / max(uGrainSize, 1.0)) + uSeed;
    float n = hash(gp) - 0.5;
    // grain is most visible in the midtones, as on film
    float w = 1.0 - abs(luma(disp) * 2.0 - 1.0);
    disp = clamp(disp + n * uGrain * 0.14 * w, 0.0, 1.0);
  }

  fragColor = vec4(disp, 1.0);
}`;

/** Separable Gaussian, used by clarity / sharpness / noise reduction. */
export const BLUR_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImage;
uniform vec2 uDirection;   // (1/w, 0) or (0, 1/h), pre-scaled by radius
void main() {
  vec4 sum = texture(uImage, vUv) * 0.227027;
  vec2 d1 = uDirection * 1.3846153846;
  vec2 d2 = uDirection * 3.2307692308;
  sum += (texture(uImage, vUv + d1) + texture(uImage, vUv - d1)) * 0.3162162162;
  sum += (texture(uImage, vUv + d2) + texture(uImage, vUv - d2)) * 0.0702702703;
  fragColor = sum;
}`;

/**
 * Detail pass: combines the developed image with its blurred copy to apply
 * clarity (large-radius local contrast), sharpness (small-radius unsharp mask)
 * and noise reduction (blend toward the blur in flat areas only).
 */
export const DETAIL_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImage;     // developed
uniform sampler2D uBlurSmall; // small radius
uniform sampler2D uBlurLarge; // large radius
uniform float uSharpness;     // -4..+4
uniform float uClarity;       // -5..+5
uniform float uNoiseReduction;// -4..+4

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 base = texture(uImage, vUv).rgb;
  vec3 small = texture(uBlurSmall, vUv).rgb;
  vec3 large = texture(uBlurLarge, vUv).rgb;
  vec3 c = base;

  if (abs(uClarity) > 0.001) {
    c += (c - large) * (uClarity * 0.18);
  }

  vec3 detail = c - small;
  if (abs(uSharpness) > 0.001) {
    c += detail * (uSharpness * 0.35);
  }

  // Noise reduction blends toward the blur, but only where there is little
  // detail — otherwise it would erase edges along with the noise.
  if (uNoiseReduction > 0.001) {
    float edge = smoothstep(0.0, 0.06, abs(luma(detail)));
    c = mix(mix(c, small, uNoiseReduction * 0.16), c, edge);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
