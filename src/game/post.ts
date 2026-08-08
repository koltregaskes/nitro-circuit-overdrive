// Post-processing shaders for the cinematic look (gauntlet iteration 1).
//
// Both exports are plain shader definitions in the same shape three's own
// example shaders use (VignetteShader et al.), so main.ts can hand them
// straight to `new ShaderPass(...)` — ShaderPass clones the uniform block, so
// these module-level objects are safe to reuse across composer rebuilds.

import * as THREE from 'three';

const SCREEN_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Split-tone colour grade: tints darks and brights apart, then trims
 * saturation and contrast. Deliberately restrained — a colour script, not a
 * photo filter.
 *
 * `shadowTint` / `highlightTint` are straight multipliers, so main.ts
 * normalises the authored theme colours to unit luminance before uploading
 * them: that keeps each tint's hue while preventing it from acting as an
 * exposure change (a dark theme colour like 0x33502e would otherwise crush
 * the shadows to black).
 */
export const GradeShader = {
  name: 'GradeShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    shadowTint: { value: new THREE.Vector3(1, 1, 1) },
    highlightTint: { value: new THREE.Vector3(1, 1, 1) },
    saturation: { value: 1.0 },
    contrast: { value: 1.0 },
    // multiplicative vignette — replaces three's VignetteShader, whose
    // mix-toward-(1-darkness) target goes NEGATIVE for darkness > 1 and hue-shifts
    // dark scenes (measured: navy corners turned olive). Multiplying toward black
    // can never change hue.
    vignette: { value: 0.42 },
  },

  vertexShader: SCREEN_VERTEX_SHADER,

  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float saturation;
uniform float contrast;
uniform float vignette;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722); // rec709

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 color = texel.rgb;

  // 1. split tone — darks take the shadow tint, brights the highlight tint
  float luma = dot(color, LUMA);
  color = mix(color * shadowTint, color * highlightTint, smoothstep(0.15, 0.85, luma));

  // 2. saturation about the (re-measured) luminance of the toned colour
  float tonedLuma = dot(color, LUMA);
  color = mix(vec3(tonedLuma), color, saturation);

  // 3. contrast about a 0.5 pivot, never letting a channel go negative
  color = max((color - 0.5) * contrast + 0.5, vec3(0.0));

  // 4. multiplicative vignette — hue-safe corner falloff
  vec2 off = vUv - 0.5;
  color *= 1.0 - smoothstep(0.35, 0.85, dot(off, off) * 2.0) * vignette;

  gl_FragColor = vec4(color, texel.a);
}
`,
};

/**
 * Tilt-shift: a 9-tap vertical gaussian whose radius ramps up with distance
 * from a horizontal focus band. The top-down camera reads as a miniature
 * diorama once the near and far edges of the frame lose focus.
 *
 * `focusCenter` / `focusWidth` are in normalised screen Y. Inside the band the
 * blur radius is exactly zero, so the racing line stays razor sharp.
 * `resolution` is the composer size in CSS pixels — the radius is expressed in
 * 720p-equivalent pixels and rescaled from it, so the effect looks identical at
 * any window size.
 */
export const TiltShiftShader = {
  name: 'TiltShiftShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1280, 720) },
    strength: { value: 0.0 },
    focusCenter: { value: 0.55 },
    focusWidth: { value: 0.34 },
  },

  vertexShader: SCREEN_VERTEX_SHADER,

  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float strength;
uniform float focusCenter;
uniform float focusWidth;

varying vec2 vUv;

// blur radius at full defocus, in pixels at a 720p-tall frame
const float MAX_RADIUS = 6.0;

// normalised gaussian, sigma ~= 1.75 taps
const float W0 = 0.2270;
const float W1 = 0.1946;
const float W2 = 0.1216;
const float W3 = 0.0540;
const float W4 = 0.0162;

void main() {
  // distance past the edge of the sharp band, remapped to 0..1 over one band width
  float beyond = abs(vUv.y - focusCenter) - focusWidth * 0.5;
  float falloff = clamp(beyond / max(focusWidth, 0.0001), 0.0, 1.0);
  float radiusPx = strength * MAX_RADIUS * smoothstep(0.0, 1.0, falloff) * (resolution.y / 720.0);

  if (radiusPx <= 0.0001) {
    gl_FragColor = texture2D(tDiffuse, vUv);
    return;
  }

  // 9 taps span +/- radiusPx, i.e. 4 steps either side of centre
  float offset = (radiusPx * 0.25) / max(resolution.y, 1.0);

  vec4 sum = texture2D(tDiffuse, vUv) * W0;
  sum += (texture2D(tDiffuse, vec2(vUv.x, vUv.y - offset))
        + texture2D(tDiffuse, vec2(vUv.x, vUv.y + offset))) * W1;
  sum += (texture2D(tDiffuse, vec2(vUv.x, vUv.y - offset * 2.0))
        + texture2D(tDiffuse, vec2(vUv.x, vUv.y + offset * 2.0))) * W2;
  sum += (texture2D(tDiffuse, vec2(vUv.x, vUv.y - offset * 3.0))
        + texture2D(tDiffuse, vec2(vUv.x, vUv.y + offset * 3.0))) * W3;
  sum += (texture2D(tDiffuse, vec2(vUv.x, vUv.y - offset * 4.0))
        + texture2D(tDiffuse, vec2(vUv.x, vUv.y + offset * 4.0))) * W4;

  gl_FragColor = sum;
}
`,
};
