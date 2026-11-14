/* metal-fx engine by Jakub Antalik (MIT, https://github.com/Jakubantalik/metal-fx); types stripped, modules joined, otherwise unchanged. */
(function(){
const __M = {};

// ---- src/engine/color.ts
__M["src/engine/color.ts"] = (function(){

/** Converts `#rrggbb` (or `#rgb`) to a normalized `[r, g, b]` triple (0\u20131). */
function hexToRgb(hex        )                           {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function rgbToHsv(r        , g        , b        )                           {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, max];
}

function hsvToRgb(h        , s        , v        )                           {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

return { hexToRgb, rgbToHsv, hsvToRgb };
})();

// ---- src/engine/perfConfig.ts
__M["src/engine/perfConfig.ts"] = (function(){

// \u2500\u2500\u2500 Frame rates \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// Main render loop: shader + canvas compositing. 66ms \u2248 15fps.
const FRAME_INTERVAL_MS = 66;

// Reflection repaint throttle. Matches main loop; CSS blur hides stepping.
const REFLECTION_INTERVAL_MS = 66;

// \u2500\u2500\u2500 Glow \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// gl.readPixels interval for luminance sampling. GPU\u2192CPU sync is expensive.
const GLOW_READBACK_INTERVAL_MS = 1500;

// Only run the glow callback every Nth rendered frame. Each update triggers
// Chrome to re-rasterize + re-blur 6 SVG paths through 2 masks.
const GLOW_SKIP_FRAMES = 1;

// Points sampled around the perimeter to find the brightest hotspot.
const PERIM_SAMPLES = 16;

// SVG path segment counts. Lower = shorter d-strings = less SVG parse work.
// Blur filters smooth out any polygon faceting.
const HALO_SEGMENTS = 16;
const EXTRA_SEGMENTS = 8;

// \u2500\u2500\u2500 GL canvas \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// Base pixel size of the offscreen GL canvas (before DPR scaling).
// The plasma is inherently blurry \u2014 higher values waste fragment work.
const CANONICAL_GL_SIZE = 96;

// Cap devicePixelRatio for the GL canvas. 3x retina is wasted on soft plasma.
const GL_DPR_CAP = 2;

return { FRAME_INTERVAL_MS, REFLECTION_INTERVAL_MS, GLOW_READBACK_INTERVAL_MS, GLOW_SKIP_FRAMES, PERIM_SAMPLES, HALO_SEGMENTS, EXTRA_SEGMENTS, CANONICAL_GL_SIZE, GL_DPR_CAP };
})();

// ---- src/engine/presets.ts
__M["src/engine/presets.ts"] = (function(){

/**
 * Bundled preset configurations for the metal effect.
 *
 * Direct ports of the three JSON files shipped alongside the canonical demo:
 *   \u2022 preset-chromatic-both-modes.json
 *   \u2022 preset-silver-both-modes.json
 *   \u2022 preset-gold-both-modes.json
 *
 * Each preset carries a `dark` and `light` mode block. Values are reproduced
 * byte-for-byte (including the `chromatic.dark.scale = 1.6` quirk that gives
 * the dark chromatic preset its noticeably chunkier features compared with
 * the other dark-mode entries).
 *
 * The fragment shader only consumes uniforms 1..5 of `palette`/`alphas` for
 * the Plasma effect, but the JSON ships 7 colors / alphas to stay
 * forward-compatible with effect 24 (Noise Flow Wide). We keep the full 7 so
 * a future variant could opt into other effects without re-importing the
 * preset definitions.
 */

                                                         
                                           

                             
                                                              
                                                                   
                                       
                                                                   
                                                                  
                    
                                                                        
                
                                                 
                    
                                                  
                
                                                              
                   
                                           
                     
                                           
                     
                                     
                
                                                   
               
                               
                   
                                            
                     
                                                              
                        
 

                         
                   
                                         
 

/** preset-chromatic-both-modes.json */
const CHROMATIC         = {
  name: 'chromatic',
  modes: {
    dark: {
      colors: ['#000000', '#aae8ff', '#c5fe9e', '#f7888d', '#0d0d0d', '#fffdc3', '#007cff'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      direction: 80,
      speed: 1.2,
      intensity: 2,
      scale: 1.6,
      softness: 0.18,
      distortion: 0.3,
      complexity: 0.68,
      shape: 1,
      blur: 1,
      vignette: 0.26,
      vigOpacity: 0.6,
      shaderOpacity: 1,
    },
    light: {
      colors: ['#ffffff', '#ffffff', '#ffffff', '#ffb3b3', '#adadad', '#f5ff70', '#007cff'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      direction: 80,
      speed: 1.2,
      intensity: 2,
      scale: 2.5,
      softness: 0.18,
      distortion: 0.3,
      complexity: 0.68,
      shape: 1,
      blur: 1,
      vignette: 0.24,
      vigOpacity: 0.16,
      shaderOpacity: 1,
    },
  },
};

/** preset-silver-both-modes.json */
const SILVER         = {
  name: 'silver',
  modes: {
    dark: {
      colors: ['#000000', '#dedede', '#747270', '#e5e5e5', '#0d0d0d', '#ffffff', '#e6e6e6'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      direction: 80,
      speed: 1.2,
      intensity: 2,
      scale: 2.5,
      softness: 0.18,
      distortion: 0.3,
      complexity: 0.68,
      shape: 1,
      blur: 1,
      vignette: 0.26,
      vigOpacity: 0.6,
      shaderOpacity: 0.88,
    },
    light: {
      colors: ['#f6f6f6', '#ffffff', '#ffffff', '#f7f7f7', '#c9c9c9', '#d0d0d0', '#d1d1d1'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      direction: 80,
      speed: 1.2,
      intensity: 2,
      scale: 2.5,
      softness: 0.18,
      distortion: 0.3,
      complexity: 0.68,
      shape: 1,
      blur: 1,
      vignette: 0.2,
      vigOpacity: 0.26,
      shaderOpacity: 1,
    },
  },
};

/** preset-gold-both-modes.json */
const GOLD         = {
  name: 'gold',
  modes: {
    dark: {
      colors: ['#000000', '#ffffff', '#ffffff', '#f7d488', '#0d0d0d', '#fffdc3', '#ffffff'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      direction: 80,
      speed: 1.0,
      intensity: 2,
      scale: 2.5,
      softness: 0.18,
      distortion: 0.3,
      complexity: 0.68,
      shape: 1,
      blur: 1,
      vignette: 0.26,
      vigOpacity: 0.6,
      shaderOpacity: 0.92,
    },
    light: {
      colors: ['#fff8e1', '#fffbe0', '#ffffff', '#fff6d6', '#d2c7a7', '#dcd2bc', '#f9f7e5'],
      alphas: [1, 1, 1, 1, 1, 1, 1],
      direction: 80,
      speed: 1.2,
      intensity: 2,
      scale: 2.5,
      softness: 0.18,
      distortion: 0.3,
      complexity: 0.68,
      shape: 1,
      blur: 1,
      vignette: 0.22,
      vigOpacity: 0.24,
      shaderOpacity: 1,
    },
  },
};

const PRESETS                             = {
  chromatic: CHROMATIC,
  silver: SILVER,
  gold: GOLD,
};



return { PRESETS };
})();

// ---- src/engine/shaders.ts
__M["src/engine/shaders.ts"] = (function(){

/**
 * Vertex + fragment shader for the metal-fx effect.
 *
 * Source-of-truth: the `FRAG_SRC` block at L3626\u20134179 of the canonical
 * `Image loader/index.html` engine. The chromatic / silver / gold presets all
 * run `effectIndex: 1` (Plasma), so we ship ONLY that branch \u2014 the original
 * carries 24 effects plus a dot-mode raster grid that this library does not
 * expose. Everything else (warp, snoise, fbm, palette, paletteAlpha, vignette,
 * gamma) is preserved character-for-character so the visible output matches
 * `metal.html` 1:1.
 *
 * Uniforms:
 *   u_resolution      vec2  \u2014 destination pixel buffer (DPR-scaled)
 *   u_time            float \u2014 seconds since boot, JS-side multiplied by speed
 *   u_color1..u_color5 vec3 \u2014 palette stops (effect 1 uses 5; uniforms 6/7 are
 *                            still uploaded for forward-compat with effect 24)
 *   u_color6, u_color7 vec3 \u2014 extra stops, unused at effect 1
 *   u_alpha1..u_alpha7 float
 *   u_intensity       float \u2014 amplitude of the wave field
 *   u_scale           float \u2014 noise zoom (smaller = chunkier features)
 *   u_direction       float \u2014 drift angle (radians)
 *   u_softness        float \u2014 kept for shader parity (effect 1 ignores)
 *   u_distortion      float \u2014 warp strength on the sin band field
 *   u_complexity      float \u2014 fbm octaves + frequency multiplier
 *   u_shape           float \u2014 kept for shader parity (effect 1 ignores)
 *   u_vignette        float \u2014 vignette range (0..1)
 *   u_vigOpacity      float \u2014 vignette darkening strength (0..1)
 *   u_blur            float \u2014 sample-radius for the 9-tap blur (0..1)
 *   u_shaderOpacity   float \u2014 final alpha multiplier (0..1)
 */
const VERT_SHADER_SRC = /* glsl */ `
  attribute vec2 a_position;
  void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAG_SHADER_SRC = /* glsl */ `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_color1, u_color2, u_color3, u_color4, u_color5, u_color6, u_color7;
  uniform float u_alpha1, u_alpha2, u_alpha3, u_alpha4, u_alpha5, u_alpha6, u_alpha7;
  uniform float u_intensity, u_scale, u_direction;
  uniform float u_softness, u_distortion, u_complexity, u_shape;
  uniform float u_vignette, u_vigOpacity, u_blur, u_shaderOpacity;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289v2(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x_) - 0.5;
    vec3 ox = floor(x_ + 0.5);
    vec3 a0 = x_ - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p, float oct) {
    float val = 0.0, amp = 0.5;
    int n = int(oct);
    for (int i = 0; i < 7; i++) {
      if (i >= n) break;
      val += amp * snoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return val;
  }

  float nfbm(vec2 p) { return fbm(p, 3.0 + u_complexity * 4.0); }

  /* 5-stop palette used by effect 1 (Plasma) \u2014 direct port of \`palette\` from
   * the canonical engine. Stops at t = 0, 0.25, 0.5, 0.75, 1.0. */
  vec3 palette(float t) {
    t = clamp(t, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    float k = 64.0;
    float w1 = u_alpha1 * exp(-k * t * t);
    float w2 = u_alpha2 * exp(-k * (t - 0.25) * (t - 0.25));
    float w3 = u_alpha3 * exp(-k * (t - 0.5)  * (t - 0.5));
    float w4 = u_alpha4 * exp(-k * (t - 0.75) * (t - 0.75));
    float w5 = u_alpha5 * exp(-k * (t - 1.0)  * (t - 1.0));
    float total = w1 + w2 + w3 + w4 + w5 + 0.0001;
    return (u_color1 * w1 + u_color2 * w2 + u_color3 * w3 +
            u_color4 * w4 + u_color5 * w5) / total;
  }

  /* Per-pixel alpha that re-introduces transparency when the user dials any
   * palette stop's alpha below 1. Same \`paletteAlpha\` from the canonical
   * engine. With every preset shipping all-1 alphas, this returns ~1 for every
   * pixel \u2014 but mirroring it keeps custom-preset behaviour identical. */
  float paletteAlpha(float t) {
    t = clamp(t, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    float k = 64.0;
    float w1 = u_alpha1 * exp(-k * t * t);
    float w2 = u_alpha2 * exp(-k * (t - 0.25) * (t - 0.25));
    float w3 = u_alpha3 * exp(-k * (t - 0.5)  * (t - 0.5));
    float w4 = u_alpha4 * exp(-k * (t - 0.75) * (t - 0.75));
    float w5 = u_alpha5 * exp(-k * (t - 1.0)  * (t - 1.0));
    float totalW = w1 + w2 + w3 + w4 + w5 + 0.0001;
    float rawW = exp(-k * t * t)
               + exp(-k * (t - 0.25) * (t - 0.25))
               + exp(-k * (t - 0.5)  * (t - 0.5))
               + exp(-k * (t - 0.75) * (t - 0.75))
               + exp(-k * (t - 1.0)  * (t - 1.0))
               + 0.0001;
    return totalW / rawW;
  }

  vec2 warp(vec2 p, float t) {
    float str = u_distortion * 2.0;
    return vec2(
      nfbm(p + vec2(t * 0.1, 0.0)),
      nfbm(p + vec2(0.0, t * 0.12) + 5.0)
    ) * str;
  }

  /* Plasma: four sine bands warped by an FBM field, mapped through the
   * 5-stop palette. Identical to effect 1 in the canonical engine. */
  vec3 computeEffect(vec2 uv, float aspect, float t, float dist, float cpx) {
    vec2 p = (uv - 0.5) * u_scale;
    p.x *= aspect;
    p += vec2(cos(u_direction), sin(u_direction)) * t * 0.15;

    float freq = 3.0 + cpx * 8.0;
    float val = 0.0;
    val += sin(p.x * freq + t);
    val += sin(p.y * freq + t * 1.3);
    val += sin((p.x + p.y) * freq * 0.7 + t * 0.7);
    val += sin(length(p) * freq * 0.8 - t * 1.5);
    vec2 w = warp(p, t);
    val += (w.x + w.y) * dist;
    val = val * 0.2 * u_intensity + 0.5;

    return palette(clamp(val, 0.0, 1.0));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    float t = u_time;          // JS already multiplied u_time by preset.speed.
    float dist = u_distortion;
    float cpx = u_complexity;

    /* 5-tap cross blur (center + cardinal offsets). The chromatic/silver/gold
     * presets all ship with blur=1 so this path is always active. 5 taps
     * instead of the canonical engine's 9 saves ~44% fragment work; the
     * perceptual difference is nil because the output is already soft from
     * the plasma's low spatial frequency and CSS blur on reflections. */
    vec3 col;
    if (u_blur < 0.01) {
      col = computeEffect(uv, aspect, t, dist, cpx);
    } else {
      float r = u_blur * 0.02;
      col  = computeEffect(uv,                  aspect, t, dist, cpx) * 0.4;
      col += computeEffect(uv + vec2( r, 0.0),  aspect, t, dist, cpx) * 0.15;
      col += computeEffect(uv + vec2(-r, 0.0),  aspect, t, dist, cpx) * 0.15;
      col += computeEffect(uv + vec2(0.0,  r),  aspect, t, dist, cpx) * 0.15;
      col += computeEffect(uv + vec2(0.0, -r),  aspect, t, dist, cpx) * 0.15;
    }

    /* Gamma punch \u2014 adds the contrast pop that defines the chromatic
     * highlights. From the canonical engine: \`col = pow(col, vec3(1.3))\`. */
    col = pow(col, vec3(1.3));

    /* Vignette \u2014 soft edge darkening so corners read as recessed. The 40-px
     * scale at the bottom of the formula is hard-coded in the canonical
     * engine; we keep it for visual parity. */
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float vigPx = 40.0 / min(u_resolution.x, u_resolution.y);
    float vigRange = vigPx * (1.0 + u_vignette * 3.0);
    float vig = edgeDist * edgeDist / (vigRange * vigRange);
    vig = smoothstep(0.0, 1.0, vig);
    col *= mix(1.0, vig, u_vignette * u_vigOpacity);

    /* Per-pixel alpha. With all-1 alphas the formula collapses to ~1 but the
     * computation matches the canonical engine so custom presets behave the
     * same. */
    float colorAlpha = (u_alpha1 + u_alpha2 + u_alpha3 + u_alpha4 + u_alpha5) / 5.0;
    if (colorAlpha < 0.999) {
      vec3 c1d = col - u_color1, c2d = col - u_color2, c3d = col - u_color3,
           c4d = col - u_color4, c5d = col - u_color5;
      float prox1 = exp(-8.0 * dot(c1d, c1d));
      float prox2 = exp(-8.0 * dot(c2d, c2d));
      float prox3 = exp(-8.0 * dot(c3d, c3d));
      float prox4 = exp(-8.0 * dot(c4d, c4d));
      float prox5 = exp(-8.0 * dot(c5d, c5d));
      float pTotal = prox1 + prox2 + prox3 + prox4 + prox5 + 0.0001;
      colorAlpha = (prox1 * u_alpha1 + prox2 * u_alpha2 + prox3 * u_alpha3 +
                    prox4 * u_alpha4 + prox5 * u_alpha5) / pTotal;
    }
    float alpha = colorAlpha;

    /* Touch the unused-at-effect-1 uniforms so GL drivers that complain about
     * declared-but-unread uniforms (some Mali / Adreno builds do) keep them
     * live. The contribution is provably zero. */
    alpha += 0.0 * (u_softness + u_shape +
                    u_alpha6 + u_alpha7 +
                    u_color6.x + u_color7.x);

    gl_FragColor = vec4(col, alpha * u_shaderOpacity);
  }
`;

/** Compile a single shader stage. Throws with the GL info log on failure. */
function compileShader(
  gl                       ,
  type        ,
  source        
)              {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('metal-fx: gl.createShader returned null');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`metal-fx: shader compile failed: ${info ?? '(no info log)'}`);
  }
  return shader;
}

/** Link a vertex + fragment shader pair into a complete program. */
function linkProgram(
  gl                       ,
  vert             ,
  frag             
)               {
  const program = gl.createProgram();
  if (!program) throw new Error('metal-fx: gl.createProgram returned null');
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`metal-fx: program link failed: ${info ?? '(no info log)'}`);
  }
  return program;
}

return { VERT_SHADER_SRC, FRAG_SHADER_SRC, compileShader, linkProgram };
})();

// ---- src/engine/renderer/core.ts
__M["src/engine/renderer/core.ts"] = (function(){
const { CANONICAL_GL_SIZE, GL_DPR_CAP } = __M["src/engine/perfConfig.ts"];
const { PRESETS } = __M["src/engine/presets.ts"];
const { compileShader, FRAG_SHADER_SRC, linkProgram, VERT_SHADER_SRC } = __M["src/engine/shaders.ts"];
/**
 * Shared WebGL renderer \u2014 one offscreen GL canvas drives all MetalFx instances.
 *
 * Architecture:
 *   1. A single offscreen GL canvas renders the plasma shader.
 *   2. Each instance owns a visible 2D canvas that receives a cropped/scaled
 *      copy of the GL output with an inner "hole punch" mask (ring effect).
 *   3. Glow sampling reads from a shared pixel buffer (gl.readPixels) that is
 *      refreshed at most every 200ms to avoid GPU pipeline flushes on every frame.
 *   4. The animation loop is capped at ~30fps \u2014 the blur + slow plasma motion
 *      makes higher rates imperceptible.
 */



const CANONICAL_PILL_W = 140;
const CANONICAL_PILL_H = 40;
const PILL_SHADER_SCALE = 1.6;
const CIRCLE_SHADER_SCALE = 1.3;

                                                              

                                  
                            
                                
                   
                    
                       
                          
                    
                      
                     
                   
                                                                            
                                                                            
                  
                  
                                                                         
                                                                             
                                                               
                      
              
                                                                       
                                                                            
                                                                              
                
                            
                                                                        
                                                          
                           
 

                                 
                                                
                            
                        
                      
                                                        
                     
                       
                       
                        
                                  
                  
                   
                            
                
              
                                  
                     
                               
                  
                   
                         
                      
                      
 

let SHARED                        = null;

// Called by ensureSharedRenderer on first init and by the contextrestored
// listener to rebuild GL state after the browser reclaims the context.
let _onContextRestored                      = null;
function setContextRestoredCallback(cb                     )       {
  _onContextRestored = cb;
}

const UNIFORM_NAMES = [
  'u_resolution', 'u_time',
  'u_color1', 'u_color2', 'u_color3', 'u_color4', 'u_color5', 'u_color6', 'u_color7',
  'u_alpha1', 'u_alpha2', 'u_alpha3', 'u_alpha4', 'u_alpha5', 'u_alpha6', 'u_alpha7',
  'u_intensity', 'u_scale', 'u_direction', 'u_softness',
  'u_distortion', 'u_complexity', 'u_shape',
  'u_vignette', 'u_vigOpacity', 'u_blur', 'u_shaderOpacity',
];

function buildGLPipeline(gl                       )   
                                                                                                    
  {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER_SRC);
  const program = linkProgram(gl, vert, frag);
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('metal-fx: gl.createBuffer returned null');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uniforms                                              = {};
  for (const n of UNIFORM_NAMES) uniforms[n] = gl.getUniformLocation(program, n);

  return { program, buffer, uniforms };
}

function ensureSharedRenderer()                 {
  if (SHARED) return SHARED;

  const dpr = Math.min(GL_DPR_CAP, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const size = Math.round(CANONICAL_GL_SIZE * dpr);
  const useOffscreen = typeof OffscreenCanvas !== 'undefined';

  let glCanvas                                     ;
  let gl                              ;

  if (useOffscreen) {
    glCanvas = new OffscreenCanvas(size, size);
    gl = glCanvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: false, antialias: false,
    })                                ;
  } else {
    const htmlCanvas = document.createElement('canvas');
    htmlCanvas.width = size;
    htmlCanvas.height = size;
    gl = (htmlCanvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true,
    }) ?? htmlCanvas.getContext('experimental-webgl'))                                ;
    glCanvas = htmlCanvas;
  }
  if (!gl) throw new Error('metal-fx: WebGL not supported');

  const { program, buffer, uniforms } = buildGLPipeline(gl);

  const onContextLost = (e       ) => { e.preventDefault(); if (SHARED) SHARED.contextLost = true; };
  const onContextRestored = () => {
    if (!SHARED) return;
    const rebuilt = buildGLPipeline(SHARED.gl);
    SHARED.program = rebuilt.program;
    SHARED.buffer = rebuilt.buffer;
    SHARED.uniforms = rebuilt.uniforms;
    SHARED.presetDirty = true;
    SHARED.contextLost = false;
    _onContextRestored?.();
  };
  glCanvas.addEventListener('webglcontextlost', onContextLost                 , false);
  glCanvas.addEventListener('webglcontextrestored', onContextRestored                 , false);

  SHARED = {
    glCanvas, gl, program, buffer, uniforms,
    preset: PRESETS.chromatic.modes.dark, presetDirty: true,
    contextLost: false, useOffscreen, frameBitmap: null,
    startMs: performance.now(), pausedMs: 0, pausedAtMs: null,
    rafId: 0, dpr, instances: new Set(), frameCount: 0,
    glowQueue: [], glowIdx: 0, glowSkip: 0,
    glowPixels: new Uint8Array(size * size * 4),
    glowPixelsW: size, glowPixelsH: size,
  };
  return SHARED;
}

function teardownSharedRenderer()       {
  if (!SHARED) return;
  const { gl, program, buffer, frameBitmap } = SHARED;
  try {
    frameBitmap?.close();
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* swallow */ }
  SHARED = null;
}

return { CANONICAL_PILL_W, CANONICAL_PILL_H, PILL_SHADER_SCALE, CIRCLE_SHADER_SCALE, get SHARED() { return SHARED; }, setContextRestoredCallback, ensureSharedRenderer, teardownSharedRenderer };
})();

// ---- src/engine/renderer/sampling.ts
__M["src/engine/renderer/sampling.ts"] = (function(){
const { GLOW_READBACK_INTERVAL_MS } = __M["src/engine/perfConfig.ts"];
const { CANONICAL_PILL_W, CANONICAL_PILL_H } = __M["src/engine/renderer/core.ts"];
/**
 * Pixel readback and luminance/colour sampling from the shared GL canvas.
 *
 * All glow luminance/color sampling reads from a shared pixel buffer
 * (__M["src/engine/renderer/core.ts"].SHARED.glowPixels). The buffer is refreshed via gl.readPixels at most
 * every GLOW_READBACK_INTERVAL_MS to avoid the expensive GPU\u2192CPU pipeline
 * flush on every frame. The plasma shader evolves slowly so 200ms-stale
 * data is visually indistinguishable.
 */


let _lastReadbackMs = 0;

function ensureGlowPixels()       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  const now = performance.now();
  if (now - _lastReadbackMs < GLOW_READBACK_INTERVAL_MS) return;
  _lastReadbackMs = now;
  const { gl, glCanvas } = __M["src/engine/renderer/core.ts"].SHARED;
  const cw = glCanvas.width, ch = glCanvas.height;
  if (__M["src/engine/renderer/core.ts"].SHARED.glowPixelsW !== cw || __M["src/engine/renderer/core.ts"].SHARED.glowPixelsH !== ch) {
    __M["src/engine/renderer/core.ts"].SHARED.glowPixelsW = cw;
    __M["src/engine/renderer/core.ts"].SHARED.glowPixelsH = ch;
    __M["src/engine/renderer/core.ts"].SHARED.glowPixels = new Uint8Array(cw * ch * 4);
  }
  gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, __M["src/engine/renderer/core.ts"].SHARED.glowPixels);
}

/**
 * Map per-instance CSS-px glow coordinates to the shared GL pixel buffer.
 *
 * The GL canvas is shared across all instances. Each instance "sees" a
 * different crop of it (computed identically to copyShaderToInstance).
 * This function reverses that mapping: given a CSS-px coordinate on the
 * instance, it returns the (bx, by) index into __M["src/engine/renderer/core.ts"].SHARED.glowPixels.
 *
 * readPixels stores rows bottom-up (GL convention) so Y is flipped.
 */
const _map = { bx: 0, by: 0 };

function mapToGlowBuf(inst                 , cssPxX        , cssPxY        )              {
  if (!__M["src/engine/renderer/core.ts"].SHARED) { _map.bx = 0; _map.by = 0; return _map; }
  const { glCanvas } = __M["src/engine/renderer/core.ts"].SHARED;
  const cw = glCanvas.width, ch = glCanvas.height;
  const dpr = inst.dpr;
  const dw = inst.cssWidth * dpr, dh = inst.cssHeight * dpr;
  const bdW = CANONICAL_PILL_W * dpr, bdH = CANONICAL_PILL_H * dpr;
  let srcW = (dw * (cw / bdW)) / inst.shaderScale;
  let srcH = (dh * (ch / bdH)) / inst.shaderScale;
  if (srcW > cw) srcW = cw;
  if (srcH > ch) srcH = ch;
  const sx = (cw - srcW) / 2;
  const sy = (ch - srcH) / 2;
  const glX = sx + (cssPxX / inst.cssWidth) * srcW;
  const glY = sy + (cssPxY / inst.cssHeight) * srcH;
  _map.bx = Math.round(glX);
  _map.by = Math.round(ch - 1 - glY);
  return _map;
}

const _sr = { r: 0, g: 0, b: 0, lum: 0, count: 0 };

function sampleRegion(
  buf            , W        , H        ,
  bx        , by        , radius        
)             {
  const r = Math.max(1, radius | 0);
  const x0 = Math.max(0, bx - r), x1 = Math.min(W, bx + r + 1);
  const y0 = Math.max(0, by - r), y1 = Math.min(H, by + r + 1);
  _sr.r = 0; _sr.g = 0; _sr.b = 0; _sr.lum = 0; _sr.count = 0;
  for (let py = y0; py < y1; py++) {
    const row = py * W;
    for (let px = x0; px < x1; px++) {
      const i = (row + px) * 4;
      _sr.r += buf[i]; _sr.g += buf[i + 1]; _sr.b += buf[i + 2];
      _sr.lum += (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      _sr.count++;
    }
  }
  return _sr;
}

const _rgb            = { r: 255, g: 255, b: 255 };

function sampleShaderLumAt(inst                 , cssPxX        , cssPxY        , radius        )         {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return 0;
  ensureGlowPixels();
  const m = mapToGlowBuf(inst, cssPxX, cssPxY);
  const s = sampleRegion(__M["src/engine/renderer/core.ts"].SHARED.glowPixels, __M["src/engine/renderer/core.ts"].SHARED.glowPixelsW, __M["src/engine/renderer/core.ts"].SHARED.glowPixelsH, m.bx, m.by, radius);
  return s.count > 0 ? s.lum / s.count : 0;
}

function sampleShaderRGBAt(inst                 , cssPxX        , cssPxY        , radius        )            {
  if (!__M["src/engine/renderer/core.ts"].SHARED) { _rgb.r = 255; _rgb.g = 255; _rgb.b = 255; return _rgb; }
  ensureGlowPixels();
  const m = mapToGlowBuf(inst, cssPxX, cssPxY);
  const s = sampleRegion(__M["src/engine/renderer/core.ts"].SHARED.glowPixels, __M["src/engine/renderer/core.ts"].SHARED.glowPixelsW, __M["src/engine/renderer/core.ts"].SHARED.glowPixelsH, m.bx, m.by, radius);
  if (s.count === 0) { _rgb.r = 255; _rgb.g = 255; _rgb.b = 255; return _rgb; }
  _rgb.r = s.r / s.count; _rgb.g = s.g / s.count; _rgb.b = s.b / s.count;
  return _rgb;
}

function sampleShaderRGBChromatic(inst                 , cssPxX        , cssPxY        , radius        )            {
  if (!__M["src/engine/renderer/core.ts"].SHARED) { _rgb.r = 255; _rgb.g = 255; _rgb.b = 255; return _rgb; }
  ensureGlowPixels();
  const m = mapToGlowBuf(inst, cssPxX, cssPxY);
  const { glowPixels: buf, glowPixelsW: W, glowPixelsH: H } = __M["src/engine/renderer/core.ts"].SHARED;
  const r = Math.max(1, radius | 0);
  const x0 = Math.max(0, m.bx - r), x1 = Math.min(W, m.bx + r + 1);
  const y0 = Math.max(0, m.by - r), y1 = Math.min(H, m.by + r + 1);
  let bestScore = -1;
  _rgb.r = 255; _rgb.g = 255; _rgb.b = 255;
  for (let py = y0; py < y1; py++) {
    const row = py * W;
    for (let px = x0; px < x1; px++) {
      const i = (row + px) * 4;
      const rr = buf[i], gg = buf[i + 1], bb = buf[i + 2];
      const maxC = Math.max(rr, gg, bb), minC = Math.min(rr, gg, bb);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      const score = sat * (0.35 + 0.65 * (maxC / 255));
      if (score > bestScore) { bestScore = score; _rgb.r = rr; _rgb.g = gg; _rgb.b = bb; }
    }
  }
  return _rgb;
}

return { ensureGlowPixels, sampleShaderLumAt, sampleShaderRGBAt, sampleShaderRGBChromatic };
})();

// ---- src/engine/renderer/loop.ts
__M["src/engine/renderer/loop.ts"] = (function(){
const { hexToRgb } = __M["src/engine/color.ts"];
const { FRAME_INTERVAL_MS, GLOW_SKIP_FRAMES } = __M["src/engine/perfConfig.ts"];
const { PRESETS } = __M["src/engine/presets.ts"];
const { CANONICAL_PILL_W, CANONICAL_PILL_H, CIRCLE_SHADER_SCALE, PILL_SHADER_SCALE, ensureSharedRenderer, setContextRestoredCallback, teardownSharedRenderer } = __M["src/engine/renderer/core.ts"];
const { ensureGlowPixels } = __M["src/engine/renderer/sampling.ts"];
/** Animation loop, per-frame compositing, and instance lifecycle. */





// Restart the animation loop when the browser restores the GL context.
setContextRestoredCallback(() => {
  if (__M["src/engine/renderer/core.ts"].SHARED && __M["src/engine/renderer/core.ts"].SHARED.instances.size > 0 && __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs === null) {
    startSharedLoop();
  }
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!__M["src/engine/renderer/core.ts"].SHARED || __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs !== null || __M["src/engine/renderer/core.ts"].SHARED.contextLost) return;
    if (document.hidden) {
      stopSharedLoop();
    } else if (__M["src/engine/renderer/core.ts"].SHARED.instances.size > 0) {
      startSharedLoop();
    }
  });
}

// \u2500\u2500\u2500 Instance lifecycle \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

                                 
                                
                   
                    
                       
                          
                       
                     
                      
                   
                 
                            
                           
 

function createInstance(opts                       )                  {
  const renderer = ensureSharedRenderer();
  const ctx = opts.hostCanvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('metal-fx: canvas 2D context unavailable');

  const scale = opts.scale ?? 1;
  const inst                  = {
    canvas: opts.hostCanvas, ctx,
    cssWidth: opts.cssWidth, cssHeight: opts.cssHeight,
    cornerRadius: opts.cornerRadius,
    kind: opts.kind,
    ringCssPx: opts.ringCssPx ?? (opts.kind === 'circle' ? 2 : 1) * scale,
    shaderScale: opts.shaderScale ?? (opts.kind === 'circle' ? CIRCLE_SHADER_SCALE : PILL_SHADER_SCALE) * scale,
    opacityMul: opts.opacityMul ?? 1,
    visible: true,
    paused: opts.paused ?? false,
    everCopied: false,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    scale,
    onAfterFrame: opts.onAfterFrame,
    onFirstCopy: opts.onFirstCopy,
  };
  resizeInstanceCanvas(inst);
  renderer.instances.add(inst);
  if (renderer.rafId === 0 && renderer.pausedAtMs === null) startSharedLoop();
  return inst;
}

function destroyInstance(inst                 )       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  __M["src/engine/renderer/core.ts"].SHARED.instances.delete(inst);
  const qi = __M["src/engine/renderer/core.ts"].SHARED.glowQueue.indexOf(inst);
  if (qi !== -1) __M["src/engine/renderer/core.ts"].SHARED.glowQueue.splice(qi, 1);
  if (__M["src/engine/renderer/core.ts"].SHARED.instances.size === 0) { stopSharedLoop(); teardownSharedRenderer(); }
}

function registerGlowInstance(inst                 )       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  if (!__M["src/engine/renderer/core.ts"].SHARED.glowQueue.includes(inst)) __M["src/engine/renderer/core.ts"].SHARED.glowQueue.push(inst);
}

function unregisterGlowInstance(inst                 )       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  const i = __M["src/engine/renderer/core.ts"].SHARED.glowQueue.indexOf(inst);
  if (i !== -1) __M["src/engine/renderer/core.ts"].SHARED.glowQueue.splice(i, 1);
}

function updateInstance(
  inst                 ,
  patch                                                                                                                                                      
)       {
  let dirty = false;
  if (patch.cssWidth !== undefined && patch.cssWidth !== inst.cssWidth) { inst.cssWidth = patch.cssWidth; dirty = true; }
  if (patch.cssHeight !== undefined && patch.cssHeight !== inst.cssHeight) { inst.cssHeight = patch.cssHeight; dirty = true; }
  if (patch.cornerRadius !== undefined) inst.cornerRadius = patch.cornerRadius;
  if (patch.scale !== undefined) inst.scale = patch.scale;
  if (patch.kind !== undefined && patch.kind !== inst.kind) {
    inst.kind = patch.kind;
    if (patch.shaderScale === undefined) inst.shaderScale = (patch.kind === 'circle' ? CIRCLE_SHADER_SCALE : PILL_SHADER_SCALE) * inst.scale;
    if (patch.ringCssPx === undefined) inst.ringCssPx = (patch.kind === 'circle' ? 2 : 1) * inst.scale;
  }
  if (patch.shaderScale !== undefined) inst.shaderScale = patch.shaderScale;
  if (patch.ringCssPx !== undefined) inst.ringCssPx = patch.ringCssPx;
  if (patch.opacityMul !== undefined) inst.opacityMul = patch.opacityMul;
  if (patch.paused !== undefined && patch.paused !== inst.paused) {
    inst.paused = patch.paused;
    // Unpausing should kick the loop if it had idled because every visible
    // instance was paused.
    if (!patch.paused && __M["src/engine/renderer/core.ts"].SHARED && __M["src/engine/renderer/core.ts"].SHARED.rafId === 0 && __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs === null && !__M["src/engine/renderer/core.ts"].SHARED.contextLost) {
      startSharedLoop();
    }
  }
  if (dirty) resizeInstanceCanvas(inst);
}

function setInstanceVisible(inst                 , visible         )       {
  inst.visible = visible;
  if (visible && __M["src/engine/renderer/core.ts"].SHARED && __M["src/engine/renderer/core.ts"].SHARED.rafId === 0 && __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs === null && !__M["src/engine/renderer/core.ts"].SHARED.contextLost) {
    startSharedLoop();
  }
}

function setSharedPreset(name            , theme             )       {
  const s = ensureSharedRenderer();
  s.preset = PRESETS[name].modes[theme];
  s.presetDirty = true;
}

function pauseShared()       {
  if (!__M["src/engine/renderer/core.ts"].SHARED || __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs !== null) return;
  __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs = performance.now();
  stopSharedLoop();
}

function resumeShared()       {
  if (!__M["src/engine/renderer/core.ts"].SHARED || __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs === null) return;
  __M["src/engine/renderer/core.ts"].SHARED.pausedMs += performance.now() - __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs;
  __M["src/engine/renderer/core.ts"].SHARED.pausedAtMs = null;
  if (__M["src/engine/renderer/core.ts"].SHARED.instances.size > 0) startSharedLoop();
}

function getSharedFrameCount()         {
  return __M["src/engine/renderer/core.ts"].SHARED?.frameCount ?? 0;
}

// \u2500\u2500\u2500 Glow callback \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

                                                                          
let _glowCallback                      = null;

function setGlowCallback(cb                     )       {
  _glowCallback = cb;
}

// \u2500\u2500\u2500 Internal rendering \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function resizeInstanceCanvas(inst                 )       {
  inst.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const w = Math.max(1, Math.round(inst.cssWidth * inst.dpr));
  const h = Math.max(1, Math.round(inst.cssHeight * inst.dpr));
  if (inst.canvas.width !== w) inst.canvas.width = w;
  if (inst.canvas.height !== h) inst.canvas.height = h;
}

function punchInnerHole(inst                 )       {
  const { ctx, dpr, canvas } = inst;
  const stroke = inst.ringCssPx * dpr;
  const w = canvas.width, h = canvas.height;
  const innerR = Math.max(0, (inst.cornerRadius - inst.ringCssPx) * dpr);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect(stroke, stroke, w - 2 * stroke, h - 2 * stroke, innerR);
  ctx.fill();
  ctx.restore();
}

function copyShaderToInstance(inst                 )       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  const src                    = __M["src/engine/renderer/core.ts"].SHARED.frameBitmap ?? __M["src/engine/renderer/core.ts"].SHARED.glCanvas;
  const dpr = inst.dpr;
  const dw = inst.canvas.width, dh = inst.canvas.height;
  if (dw < 1 || dh < 1) return;

  const cw = __M["src/engine/renderer/core.ts"].SHARED.glCanvas.width, ch = __M["src/engine/renderer/core.ts"].SHARED.glCanvas.height;
  const bdW = CANONICAL_PILL_W * dpr, bdH = CANONICAL_PILL_H * dpr;
  let srcW = (dw * (cw / bdW)) / inst.shaderScale;
  let srcH = (dh * (ch / bdH)) / inst.shaderScale;
  if (srcW > cw) srcW = cw;
  if (srcH > ch) srcH = ch;
  const sx = Math.max(0, (cw - srcW) / 2);
  const sy = Math.max(0, (ch - srcH) / 2);

  inst.ctx.clearRect(0, 0, dw, dh);
  if (inst.opacityMul < 1) inst.ctx.globalAlpha = inst.opacityMul;
  inst.ctx.drawImage(src, sx, sy, srcW, srcH, 0, 0, dw, dh);
  if (inst.opacityMul < 1) inst.ctx.globalAlpha = 1;

  punchInnerHole(inst);
  if (inst.onFirstCopy) { const cb = inst.onFirstCopy; inst.onFirstCopy = undefined; cb(); }
  inst.onAfterFrame?.();
}

function uploadPresetUniforms()       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  const { gl, uniforms, preset, glCanvas } = __M["src/engine/renderer/core.ts"].SHARED;
  if (uniforms.u_resolution) gl.uniform2f(uniforms.u_resolution, glCanvas.width, glCanvas.height);
  for (let i = 0; i < 7; i++) {
    const cLoc = uniforms[`u_color${i + 1}`];
    if (cLoc) { const [r, g, b] = hexToRgb(preset.colors[i]); gl.uniform3f(cLoc, r, g, b); }
    const aLoc = uniforms[`u_alpha${i + 1}`];
    if (aLoc) gl.uniform1f(aLoc, preset.alphas[i]);
  }
  if (uniforms.u_intensity) gl.uniform1f(uniforms.u_intensity, preset.intensity);
  if (uniforms.u_scale) gl.uniform1f(uniforms.u_scale, preset.scale);
  if (uniforms.u_direction) gl.uniform1f(uniforms.u_direction, (preset.direction * Math.PI) / 180);
  if (uniforms.u_softness) gl.uniform1f(uniforms.u_softness, preset.softness);
  if (uniforms.u_distortion) gl.uniform1f(uniforms.u_distortion, preset.distortion);
  if (uniforms.u_complexity) gl.uniform1f(uniforms.u_complexity, preset.complexity);
  if (uniforms.u_shape) gl.uniform1f(uniforms.u_shape, preset.shape);
  if (uniforms.u_vignette) gl.uniform1f(uniforms.u_vignette, preset.vignette);
  if (uniforms.u_vigOpacity) gl.uniform1f(uniforms.u_vigOpacity, preset.vigOpacity);
  if (uniforms.u_blur) gl.uniform1f(uniforms.u_blur, preset.blur);
  if (uniforms.u_shaderOpacity) gl.uniform1f(uniforms.u_shaderOpacity, preset.shaderOpacity);
  __M["src/engine/renderer/core.ts"].SHARED.presetDirty = false;
}

function renderSharedFrame(now        )       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  const { gl, uniforms, preset, glCanvas } = __M["src/engine/renderer/core.ts"].SHARED;
  const t = ((now - __M["src/engine/renderer/core.ts"].SHARED.startMs - __M["src/engine/renderer/core.ts"].SHARED.pausedMs) / 1000) * preset.speed;

  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (__M["src/engine/renderer/core.ts"].SHARED.presetDirty) uploadPresetUniforms();
  if (uniforms.u_time) gl.uniform1f(uniforms.u_time, t);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  __M["src/engine/renderer/core.ts"].SHARED.frameCount++;
}

let lastFrameMs = 0;

function tick(now        )       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  if (__M["src/engine/renderer/core.ts"].SHARED.contextLost) { __M["src/engine/renderer/core.ts"].SHARED.rafId = 0; return; }

  // Loop stays alive while at least one visible instance still has work to do
  // \u2014 i.e. it's either unpaused (needs a fresh copy each frame) or paused but
  // hasn't yet painted its first frame (initial-mount-paused case).
  let anyWork = false;
  for (const inst of __M["src/engine/renderer/core.ts"].SHARED.instances) {
    if (inst.visible && (!inst.paused || !inst.everCopied)) { anyWork = true; break; }
  }
  if (!anyWork) { __M["src/engine/renderer/core.ts"].SHARED.rafId = 0; return; }

  __M["src/engine/renderer/core.ts"].SHARED.rafId = requestAnimationFrame(tick);
  if (now - lastFrameMs < FRAME_INTERVAL_MS) return;
  lastFrameMs = now;

  renderSharedFrame(now);

  if (__M["src/engine/renderer/core.ts"].SHARED.useOffscreen) {
    if (__M["src/engine/renderer/core.ts"].SHARED.glowQueue.length > 0) ensureGlowPixels();
    __M["src/engine/renderer/core.ts"].SHARED.frameBitmap?.close();
    __M["src/engine/renderer/core.ts"].SHARED.frameBitmap = (__M["src/engine/renderer/core.ts"].SHARED.glCanvas                   ).transferToImageBitmap();
  }

  for (const inst of __M["src/engine/renderer/core.ts"].SHARED.instances) {
    if (!inst.visible) continue;
    if (inst.paused && inst.everCopied) continue;
    copyShaderToInstance(inst);
    inst.everCopied = true;
  }

  if (_glowCallback && __M["src/engine/renderer/core.ts"].SHARED.glowQueue.length > 0 && ++__M["src/engine/renderer/core.ts"].SHARED.glowSkip % GLOW_SKIP_FRAMES === 0) {
    const queue = __M["src/engine/renderer/core.ts"].SHARED.glowQueue;
    if (__M["src/engine/renderer/core.ts"].SHARED.glowIdx >= queue.length) __M["src/engine/renderer/core.ts"].SHARED.glowIdx = 0;
    const inst = queue[__M["src/engine/renderer/core.ts"].SHARED.glowIdx];
    // Skip glow frames for paused instances so their halo also freezes
    // (otherwise the catch-light would keep travelling on a frozen ring).
    if (inst.visible && !inst.paused) _glowCallback(inst, now);
    __M["src/engine/renderer/core.ts"].SHARED.glowIdx++;
  }
}

function startSharedLoop()       {
  if (!__M["src/engine/renderer/core.ts"].SHARED || __M["src/engine/renderer/core.ts"].SHARED.rafId !== 0) return;
  __M["src/engine/renderer/core.ts"].SHARED.rafId = requestAnimationFrame(tick);
}

function stopSharedLoop()       {
  if (!__M["src/engine/renderer/core.ts"].SHARED) return;
  if (__M["src/engine/renderer/core.ts"].SHARED.rafId !== 0) cancelAnimationFrame(__M["src/engine/renderer/core.ts"].SHARED.rafId);
  __M["src/engine/renderer/core.ts"].SHARED.rafId = 0;
}

return { createInstance, destroyInstance, registerGlowInstance, unregisterGlowInstance, updateInstance, setInstanceVisible, setSharedPreset, pauseShared, resumeShared, getSharedFrameCount, setGlowCallback };
})();

// ---- src/engine/tween.ts
__M["src/engine/tween.ts"] = (function(){

                                           

const ease = {
  linear: (t        ) => t,
  smoothstep: (t        ) => t * t * (3 - 2 * t),
}         ;

                        
               
             
              
               
                  
              
                
 

function tween(from        , to        , dur        , e         = ease.linear)        {
  return { from, to, dur, ease: e, startMs: -1, val: from, done: false };
}

function tweenStart(tw       , nowMs        )       {
  tw.startMs = nowMs;
  tw.val = tw.from;
  tw.done = false;
}

function tweenTick(tw       , nowMs        )         {
  if (tw.done || tw.startMs < 0) return tw.val;
  const t = Math.min(1, (nowMs - tw.startMs) / tw.dur);
  tw.val = tw.from + (tw.to - tw.from) * tw.ease(t);
  if (t >= 1) tw.done = true;
  return tw.val;
}

return { ease, tween, tweenStart, tweenTick };
})();

// ---- src/engine/glow/geometry.ts
__M["src/engine/glow/geometry.ts"] = (function(){
const { PERIM_SAMPLES } = __M["src/engine/perfConfig.ts"];
/**
 * Pure geometry + SVG markup for the glow overlay.
 *
 * Perimeter math (rounded-rect / circle arc-length sampling), blob path
 * generation, SVG filter/mask construction, and HSV colour helpers.
 * No state \u2014 every function is a pure transform.
 */

const INSET = 1.5;
const EXTRA_SCALE = 1 / 3;
const EXTRA_STROKE_OUTER = 4.0 * EXTRA_SCALE;
const EXTRA_STROKE_CORE = 2.0 * EXTRA_SCALE;
const EXTRA_BLUR_OUTER = 2.0 * EXTRA_SCALE;
const EXTRA_BLUR_CORE = 1.35 * EXTRA_SCALE;
const EXTRA_FADE_R = 13.0 * EXTRA_SCALE;


                              
                
                 
                       
                          
                                                                    
                                                                         
                                                                       
                                       
                 
 
                                            
                                                       

function rrPerim(w        , h        , r        )         {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  return 2 * Math.max(0, w - 2 * rr) + 2 * Math.max(0, h - 2 * rr) + 2 * Math.PI * rr;
}

function shapePerim(w        , h        , r        , kind                   )         {
  if (kind === 'circle') return 2 * Math.PI * Math.max(0, Math.min(r, Math.min(w, h) / 2));
  return rrPerim(w, h, r);
}

function sampleAtArc(s        , w        , h        , r        , inset        , outward        , kind                   , out     )     {
  const o = out || { x: 0, y: 0 };
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (kind === 'circle') {
    const perim = 2 * Math.PI * rr;
    if (perim <= 0.0001) { o.x = w * 0.5; o.y = h * 0.5; return o; }
    s = ((s % perim) + perim) % perim;
    const theta = -Math.PI / 2 + (s / perim) * Math.PI * 2;
    const rad = Math.max(0, rr - inset + outward);
    o.x = w * 0.5 + rad * Math.cos(theta);
    o.y = h * 0.5 + rad * Math.sin(theta);
    return o;
  }
  const topLen = Math.max(0, w - 2 * rr), sideLen = Math.max(0, h - 2 * rr);
  const arcLen = (Math.PI * rr) / 2;
  const perim = 2 * (topLen + sideLen) + 4 * arcLen;
  s = ((s % perim) + perim) % perim;
  const rad = Math.max(0, rr - inset + outward);
  let d = s;
  if (d < topLen) { o.x = rr + d; o.y = inset - outward; return o; }
  d -= topLen;
  if (d < arcLen) {
    const theta = -Math.PI / 2 + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
    o.x = (w - rr) + rad * Math.cos(theta); o.y = rr + rad * Math.sin(theta); return o;
  }
  d -= arcLen;
  if (d < sideLen) { o.x = w - inset + outward; o.y = rr + d; return o; }
  d -= sideLen;
  if (d < arcLen) {
    const theta = (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
    o.x = (w - rr) + rad * Math.cos(theta); o.y = (h - rr) + rad * Math.sin(theta); return o;
  }
  d -= arcLen;
  if (d < topLen) { o.x = w - rr - d; o.y = h - inset + outward; return o; }
  d -= topLen;
  if (d < arcLen) {
    const theta = Math.PI / 2 + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
    o.x = rr + rad * Math.cos(theta); o.y = (h - rr) + rad * Math.sin(theta); return o;
  }
  d -= arcLen;
  if (d < sideLen) { o.x = inset - outward; o.y = h - rr - d; return o; }
  d -= sideLen;
  const theta = Math.PI + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
  o.x = rr + rad * Math.cos(theta); o.y = rr + rad * Math.sin(theta);
  return o;
}

function buildStaticBlobPath(halfLen        , segments        )         {
  const step = (halfLen * 2) / segments;
  let d = '';
  for (let i = 0; i <= segments; i++) {
    const x = -halfLen + i * step;
    d += (i === 0 ? 'M ' : 'L ') + x.toFixed(3) + ' 0 ';
  }
  return d;
}

const _ta     = { x: 0, y: 0 };
const _tb     = { x: 0, y: 0 };

function tangentAngleAtArc(s        , w        , h        , r        , inset        , kind                   )         {
  const eps = 0.1;
  sampleAtArc(s - eps, w, h, r, inset, 0, kind, _ta);
  sampleAtArc(s + eps, w, h, r, inset, 0, kind, _tb);
  return Math.atan2(_tb.y - _ta.y, _tb.x - _ta.x);
}

function smoothstep(a        , b        , x        )         {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function buildPerimTable(opts             )                {
  const perim = shapePerim(opts.width, opts.height, opts.cornerRadius, opts.kind);
  const insetS = INSET * (opts.scale ?? 1);
  const table                = [];
  for (let i = 0; i < PERIM_SAMPLES; i++) {
    const arc = (i / PERIM_SAMPLES) * perim;
    const pt = sampleAtArc(arc, opts.width, opts.height, opts.cornerRadius, insetS, 0, opts.kind);
    table.push({ x: pt.x, y: pt.y, arc });
  }
  return table;
}

function buildSvgMarkup(opts             , p        )         {
  const { width: W, height: H, cornerRadius: R } = opts;
  const s = opts.scale ?? 1;
  const ringInset = opts.kind === 'circle' ? 2 : 1;
  const innerR = Math.max(0, R - ringInset);
  // Filter region grows with scale so blurred strokes don't get clipped at
  // bigger sizes. The 200/540/440 baseline matches the canonical 1\u00d7 pill.
  const fX = (-200 * s).toFixed(0), fY = fX;
  const fW = (540 * s).toFixed(0), fH = (440 * s).toFixed(0);
  const fRect = `x="${fX}" y="${fY}" width="${fW}" height="${fH}"`;
  const fr = `${fRect} filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`;
  // Stroke widths and blur stdDeviations are absolute SVG units; multiply
  // by `s` so they remain proportional when viewBox grows with the host.
  const sw = (n        ) => (n * s).toFixed(3);
  const sd = (n        ) => (n * s).toFixed(3);
  return [
    '<defs>',
    `<filter id="${p}_bXl" ${fr}><feGaussianBlur stdDeviation="${sd(8.4)}"/></filter>`,
    `<filter id="${p}_bLg" ${fr}><feGaussianBlur stdDeviation="${sd(4.8)}"/></filter>`,
    `<filter id="${p}_bMd" ${fr}><feGaussianBlur stdDeviation="${sd(2.1)}"/></filter>`,
    `<filter id="${p}_bSm" ${fr}><feGaussianBlur stdDeviation="${sd(0.9)}"/></filter>`,
    `<filter id="${p}_ebO" ${fr}><feGaussianBlur stdDeviation="${sd(EXTRA_BLUR_OUTER)}"/></filter>`,
    `<filter id="${p}_ebC" ${fr}><feGaussianBlur stdDeviation="${sd(EXTRA_BLUR_CORE)}"/></filter>`,
    `<radialGradient id="${p}_fg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="white"/><stop offset="0.30" stop-color="white"/><stop offset="0.65" stop-color="#404040"/><stop offset="1" stop-color="black"/></radialGradient>`,
    `<mask id="${p}_fm" maskUnits="userSpaceOnUse" ${fRect}><rect ${fRect} fill="black"/><circle id="${p}_fc" cx="0" cy="0" r="${(EXTRA_FADE_R * s).toFixed(3)}" fill="url(#${p}_fg)"/></mask>`,
    `<mask id="${p}_rm" maskUnits="userSpaceOnUse" ${fRect}><rect ${fRect} fill="#808080"/><rect x="0" y="0" width="${W}" height="${H}" rx="${R}" ry="${R}" fill="white"/><rect x="${ringInset}" y="${ringInset}" width="${W - ringInset * 2}" height="${H - ringInset * 2}" rx="${innerR}" ry="${innerR}" fill="black"/></mask>`,
    '</defs>',
    // Safari clips mask to the masked element's bbox; our horizontal strokes
    // have zero height, so the mask becomes a sliver. These spacer rects
    // inflate the bbox to the full filter region.
    `<g id="${p}_h" mask="url(#${p}_rm)" opacity="0">`,
    `<rect ${fRect} fill="none" pointer-events="none"/>`,
    `<g id="${p}_hI" stroke="white">`,
    `<path id="${p}_pXl" stroke-width="${sw(26.4)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.385" filter="url(#${p}_bXl)"/>`,
    `<path id="${p}_pLg" stroke-width="${sw(15.6)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.595" filter="url(#${p}_bLg)"/>`,
    `<path id="${p}_pMd" stroke-width="${sw(7.2)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.70" filter="url(#${p}_bMd)"/>`,
    `<path id="${p}_pSm" stroke-width="${sw(3.0)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.70" filter="url(#${p}_bSm)"/>`,
    '</g></g>',
    `<g id="${p}_e" mask="url(#${p}_rm)" opacity="0">`,
    `<rect ${fRect} fill="none" pointer-events="none"/>`,
    `<g mask="url(#${p}_fm)">`,
    `<g id="${p}_eI" stroke="white">`,
    `<path id="${p}_eO" stroke-width="${sw(EXTRA_STROKE_OUTER)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.85" filter="url(#${p}_ebO)"/>`,
    `<path id="${p}_eC" stroke-width="${sw(EXTRA_STROKE_CORE)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="1.0" filter="url(#${p}_ebC)"/>`,
    '</g></g></g>',
  ].join('');
}

return { rrPerim, shapePerim, sampleAtArc, buildStaticBlobPath, tangentAngleAtArc, smoothstep, buildPerimTable, buildSvgMarkup, PERIM_SAMPLES };
})();

// ---- src/engine/glow/glow.ts
__M["src/engine/glow/glow.ts"] = (function(){
const { HALO_SEGMENTS, EXTRA_SEGMENTS } = __M["src/engine/perfConfig.ts"];
const { sampleShaderLumAt, sampleShaderRGBAt, sampleShaderRGBChromatic } = __M["src/engine/renderer/sampling.ts"];
const { ease, tween, tweenStart, tweenTick } = __M["src/engine/tween.ts"];
const { hsvToRgb, rgbToHsv } = __M["src/engine/color.ts"];
const { PERIM_SAMPLES, buildPerimTable, buildStaticBlobPath, buildSvgMarkup, rrPerim, sampleAtArc, shapePerim, smoothstep, tangentAngleAtArc } = __M["src/engine/glow/geometry.ts"];
/**
 * SVG glow overlay \u2014 a luminance-driven halo that tracks the brightest point
 * on the shader's perimeter.
 *
 * How it works:
 *   1. Samples luminance at N points around the component's perimeter.
 *   2. A state machine tracks which perimeter point is brightest, with dwell
 *      timers and fade-in/out transitions when relocating to a new hotspot.
 *   3. Static SVG path elements (blurred strokes at multiple radii) are
 *      positioned at the current hotspot via CSS transform.
 *   4. The stroke color is tinted to match the shader's color at that point.
 */






// \u2500\u2500\u2500 Constants \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const FADE_RATE = 0.00875;
const LO = 0.08, HI = 0.32;
const RELOCATE_DELTA = 0.05;
const MIN_DWELL_MS = 3000;
const PEAK_OP = 0.85, BASE_OP = 0.34;
const RELOC_FADE_MS = 1500;
const WANDER_RANGE = 15, WANDER_LERP = 0.0075, WANDER_RETARGET = 120;
const INSET = 1.5;
const HALO_HALFLEN = 7.8;
const EXTRA_HALFLEN = 9.13952, EXTRA_OUTWARD = 1.0;
const EXTRA_SCALE = 1 / 3;
const HALO_OP_MUL = 0.8;
const EXTRA_INTENSITY = 3.51;
const TINT_HOLD_MS = 2000, TINT_FADE_MS = 400;
const LT_SAT_BOOST = 2.625, LT_VAL_MULT = 1.008, LT_MIN_VAL = 0.31;
const REF_W = 140, REF_H = 40, REF_R = 20;

// \u2500\u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500



                              
                     
                         
                         
                          
                          
                               
                                                                               
                                                                    
                                                                       
                                   
                
                       
                                                              
                                                 
                                                               
                                                                                             
                                                  
 

let glowIdSeq = 0;
const _pt     = { x: 0, y: 0 };

// \u2500\u2500\u2500 Public API \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function injectGlow(container             , opts             )              {
  const p = `mfxg_${++glowIdSeq}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'metal-fx-glow-svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', `0 0 ${opts.width} ${opts.height}`);
  svg.innerHTML = buildSvgMarkup(opts, p);
  container.appendChild(svg);

  const q = (id        ) => svg.querySelector(`#${p}_${id}`)              ;
  const haloGroup = q('h')               ;
  const haloInner = q('hI')               ;
  const extraGroup = q('e')               ;
  const extraInner = q('eI')               ;
  const fadeCircle = q('fc')                    ;

  const ratio = shapePerim(opts.width, opts.height, opts.cornerRadius, opts.kind) / rrPerim(REF_W, REF_H, REF_R);
  const haloHL = Math.max(1, HALO_HALFLEN * ratio);
  const extraHL = Math.max(0.6, EXTRA_HALFLEN * EXTRA_SCALE * ratio);
  const haloD = buildStaticBlobPath(haloHL, HALO_SEGMENTS);
  const extraD = buildStaticBlobPath(extraHL, EXTRA_SEGMENTS);

  const haloPaths = [q('pXl'), q('pLg'), q('pMd'), q('pSm')]                    ;
  const extraPaths = [q('eO'), q('eC')]                    ;
  for (const path of haloPaths) path.setAttribute('d', haloD);
  for (const path of extraPaths) path.setAttribute('d', extraD);

  haloInner.style.transformOrigin = '0 0';
  extraInner.style.transformOrigin = '0 0';
  haloInner.style.willChange = 'transform';
  extraInner.style.willChange = 'transform';
  haloInner.style.transition = 'transform 100ms linear';
  extraInner.style.transition = 'transform 100ms linear';

  haloGroup.style.willChange = 'opacity';
  extraGroup.style.willChange = 'opacity';
  haloGroup.style.transition = 'opacity 100ms linear';
  extraGroup.style.transition = 'opacity 100ms linear';

  fadeCircle.style.willChange = 'transform';

  return {
    svg, haloGroup, haloInner, extraGroup, extraInner, fadeCircle,
    width: opts.width, height: opts.height, cornerRadius: opts.cornerRadius, kind: opts.kind,
    scale: opts.scale ?? 1,
    perim: buildPerimTable(opts),
    currentIdx: 0, appearedAt: 0, glowOpacity: 0,
    relocTween: null, relocNextIdx: -1,
    wanderS: 0, wanderTargetS: 0, wanderFrames: 0,
    tintFrom: { r: 255, g: 255, b: 255 }, tintTarget: { r: 255, g: 255, b: 255 }, tintTween: null, tintHoldUntil: 0,
    lastHaloStroke: '', lastExtraStroke: '',
  };
}

// \u2500\u2500\u2500 Per-frame update \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function updateGlow(h             , inst                 , nowMs        , strengthMul        , theme                   = 'dark')       {
  const { width: W, height: H, cornerRadius: R, perim } = h;
  if (perim.length === 0) return;

  const halfWin = 2;

  let maxLum = -1, maxIdx = h.currentIdx, curLum = 0;
  for (let i = 0; i < perim.length; i++) {
    const pt = perim[i];
    const lum = sampleShaderLumAt(inst, pt.x, pt.y, halfWin);
    if (lum > maxLum) { maxLum = lum; maxIdx = i; }
    if (i === h.currentIdx) curLum = lum;
  }

  const dwellActive = h.appearedAt > 0 && nowMs - h.appearedAt < MIN_DWELL_MS;
  const targetOp = BASE_OP + (PEAK_OP - BASE_OP) * smoothstep(LO, HI, curLum);
  const rivalDominates = !dwellActive && maxLum - curLum > RELOCATE_DELTA;

  if (!h.relocTween || h.relocTween.done) {
    if (h.appearedAt === 0) {
      h.currentIdx = maxIdx; h.appearedAt = nowMs;
      h.wanderS = 0; h.wanderTargetS = 0; h.wanderFrames = 0;
      h.relocTween = tween(0, targetOp, RELOC_FADE_MS, ease.smoothstep);
      tweenStart(h.relocTween, nowMs);
    } else if (h.relocTween?.done && h.relocTween.to === 0) {
      h.currentIdx = h.relocNextIdx; h.appearedAt = nowMs;
      h.wanderS = 0; h.wanderTargetS = 0; h.wanderFrames = 0;
      const np = perim[h.currentIdx];
      const nl = sampleShaderLumAt(inst, np.x, np.y, halfWin);
      const fadeInTarget = BASE_OP + (PEAK_OP - BASE_OP) * smoothstep(LO, HI, nl);
      h.relocTween = tween(0, fadeInTarget, RELOC_FADE_MS, ease.smoothstep);
      tweenStart(h.relocTween, nowMs);
    } else if (rivalDominates) {
      h.relocNextIdx = maxIdx;
      h.relocTween = tween(h.glowOpacity, 0, RELOC_FADE_MS, ease.smoothstep);
      tweenStart(h.relocTween, nowMs);
    } else {
      h.glowOpacity += (targetOp - h.glowOpacity) * FADE_RATE;
    }
  }

  if (h.relocTween) {
    h.glowOpacity = tweenTick(h.relocTween, nowMs);
  }
  h.glowOpacity = Math.max(0, Math.min(1, h.glowOpacity));

  const ratio = shapePerim(W, H, R, h.kind) / rrPerim(REF_W, REF_H, REF_R);
  const wanderRange = WANDER_RANGE * ratio;
  if (h.wanderFrames++ >= WANDER_RETARGET) { h.wanderTargetS = (Math.random() * 2 - 1) * wanderRange; h.wanderFrames = 0; }
  h.wanderS += (h.wanderTargetS - h.wanderS) * WANDER_LERP;

  const blobArc = perim[h.currentIdx].arc + h.wanderS;

  // INSET / EXTRA_OUTWARD are absolute SVG-unit offsets; multiply by the
  // master scale so the catch-light sits at the right perpendicular distance
  // when the host element is rendered at non-1\u00d7 layout (e.g. CSS zoom: 2).
  const insetS = INSET * h.scale;
  sampleAtArc(blobArc, W, H, R, insetS, 0, h.kind, _pt);
  const blobX = _pt.x, blobY = _pt.y;
  const tangent = tangentAngleAtArc(blobArc, W, H, R, insetS, h.kind);
  const tx = `translate(${blobX.toFixed(3)}px,${blobY.toFixed(3)}px) rotate(${tangent.toFixed(4)}rad)`;
  h.haloInner.style.transform = tx;

  const extraOut = EXTRA_OUTWARD * ratio * h.scale;
  sampleAtArc(blobArc, W, H, R, insetS, extraOut, h.kind, _pt);
  h.extraInner.style.transform = `translate(${_pt.x.toFixed(3)}px,${_pt.y.toFixed(3)}px) rotate(${tangent.toFixed(4)}rad)`;
  h.fadeCircle.style.transform = `translate(${_pt.x.toFixed(3)}px,${_pt.y.toFixed(3)}px)`;

  const light = theme === 'light';
  const samp = light
    ? sampleShaderRGBChromatic(inst, blobX, blobY, halfWin)
    : sampleShaderRGBAt(inst, blobX, blobY, halfWin);

  if (!h.tintTween) {
    h.tintFrom = { ...samp }; h.tintTarget = { ...samp };
    h.tintTween = tween(0, 1, TINT_FADE_MS);
    tweenStart(h.tintTween, nowMs);
    h.tintHoldUntil = light ? 0 : nowMs + TINT_HOLD_MS;
  } else if (h.tintTween.done) {
    if (light) {
      h.tintFrom = {
        r: h.tintFrom.r + (h.tintTarget.r - h.tintFrom.r) * h.tintTween.val,
        g: h.tintFrom.g + (h.tintTarget.g - h.tintFrom.g) * h.tintTween.val,
        b: h.tintFrom.b + (h.tintTarget.b - h.tintFrom.b) * h.tintTween.val,
      };
      h.tintTarget = { ...samp };
      h.tintTween = tween(0, 1, TINT_FADE_MS);
      tweenStart(h.tintTween, nowMs);
    } else if (nowMs >= h.tintHoldUntil) {
      h.tintFrom = { ...h.tintTarget };
      h.tintTarget = { ...samp };
      h.tintTween = tween(0, 1, TINT_FADE_MS);
      tweenStart(h.tintTween, nowMs);
      h.tintHoldUntil = nowMs + TINT_HOLD_MS;
    }
  }
  tweenTick(h.tintTween , nowMs);
  const ft = h.tintTween .val;

  let tR        , tG        , tB        ;
  if (light) {
    tR = Math.round(h.tintFrom.r + (h.tintTarget.r - h.tintFrom.r) * ft);
    tG = Math.round(h.tintFrom.g + (h.tintTarget.g - h.tintFrom.g) * ft);
    tB = Math.round(h.tintFrom.b + (h.tintTarget.b - h.tintFrom.b) * ft);
  } else {
    const hR = h.tintFrom.r + (h.tintTarget.r - h.tintFrom.r) * ft;
    const hG = h.tintFrom.g + (h.tintTarget.g - h.tintFrom.g) * ft;
    const hB = h.tintFrom.b + (h.tintTarget.b - h.tintFrom.b) * ft;
    const peak = Math.max(hR, hG, hB) || 1;
    tR = Math.round(255 * (hR / peak)); tG = Math.round(255 * (hG / peak)); tB = Math.round(255 * (hB / peak));
  }

  const tinted = `rgb(${tR},${tG},${tB})`;
  if (tinted !== h.lastHaloStroke) { h.lastHaloStroke = tinted; h.haloInner.style.stroke = tinted; }

  if (light) {
    const hsv = rgbToHsv(tR, tG, tB);
    const [er, eg, eb] = hsvToRgb(hsv[0], Math.min(1, hsv[1] * LT_SAT_BOOST), Math.max(LT_MIN_VAL, hsv[2] * LT_VAL_MULT));
    const extraTinted = `rgb(${er},${eg},${eb})`;
    if (extraTinted !== h.lastExtraStroke) { h.lastExtraStroke = extraTinted; h.extraInner.style.stroke = extraTinted; }
  } else if (h.lastExtraStroke !== '#ffffff') {
    h.lastExtraStroke = '#ffffff'; h.extraInner.style.stroke = '#ffffff';
  }

  const m = Math.max(0, Math.min(1, strengthMul));
  h.haloGroup.style.opacity = (h.glowOpacity * HALO_OP_MUL * m).toFixed(3);
  h.extraGroup.style.opacity = Math.min(1, h.glowOpacity * EXTRA_INTENSITY * m).toFixed(3);
}

function resizeGlow(handles             , container             , opts             )              {
  for (const svg of Array.from(container.querySelectorAll('.metal-fx-glow-svg'))) {
    if (svg.parentNode === container) container.removeChild(svg);
  }
  void handles;
  return injectGlow(container, opts);
}

return { injectGlow, updateGlow, resizeGlow };
})();

// ---- src/engine/reflection/constants.ts
__M["src/engine/reflection/constants.ts"] = (function(){

/**
 * Canonical constants and types for proximity reflections.
 *
 * Verbatim from `Image loader/index.html` L5851-5915. Shared across
 * the observer, geometry, and paint modules.
 */


const RANGE_PX = 12;
const ATTACH_RANGE_PX = 32;
const OVERLAP_MIN_PX = 1;
const BASE_ALPHA = 0.55;
const BOOST_ALPHA = 1.0;
const GRAD_NEAR = 1.0;
const GRAD_MID = 0.85;
const GRAD_FAR = 0.0;
const INTENSITY_MULT = 1.3;
const MAX_ALPHA_STACK = 3.6;
const GLOBAL_ATTENUATION = 0.7;
const STROKE_CSS_PX = 1;
const STROKE_EXTRA_ALPHA = 0.52;
const BORDER_HILITE_PX = 1.0;
const BORDER_HILITE_ALPHA = 0.044;
const REF_DRAW_CSS_W = 235;
const FILL_EXTRA_ALPHA = 2.535;
const FILL_OPACITY_MUL = 0.7;
const FILL_CIRCLE_ATTENUATION = 0.5;

const REFLECTION_BLOCKED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

                                   
                  
                          
                        
                       
                            
                                
                                  
                                      
                       
                        
                             
                                   
                            
                                        
                                            
 

return { RANGE_PX, ATTACH_RANGE_PX, OVERLAP_MIN_PX, BASE_ALPHA, BOOST_ALPHA, GRAD_NEAR, GRAD_MID, GRAD_FAR, INTENSITY_MULT, MAX_ALPHA_STACK, GLOBAL_ATTENUATION, STROKE_CSS_PX, STROKE_EXTRA_ALPHA, BORDER_HILITE_PX, BORDER_HILITE_ALPHA, REF_DRAW_CSS_W, FILL_EXTRA_ALPHA, FILL_OPACITY_MUL, FILL_CIRCLE_ATTENUATION, REFLECTION_BLOCKED_TAGS };
})();

// ---- src/engine/reflection/geometry.ts
__M["src/engine/reflection/geometry.ts"] = (function(){
const { RANGE_PX } = __M["src/engine/reflection/constants.ts"];
/**
 * Canvas 2D drawing primitives for proximity reflections.
 *
 * All the low-level compositing passes \u2014 rounded-rect paths, ring clips,
 * fill/stroke multi-pass alpha stacking, mirror-flip drawImage, and the
 * border-highlight gradient stroke.
 */

// \u2500\u2500\u2500 Layout helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function shortestRectDistance(a         , b         )         {
  const dx = Math.max(a.left - b.right, b.left - a.right, 0);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function isHorizontalNeighbour(anchorRect         , targetRect         , overlapMin        , attachRange        )          {
  const verticalOverlap =
    Math.min(anchorRect.bottom, targetRect.bottom) -
    Math.max(anchorRect.top, targetRect.top);
  if (verticalOverlap < overlapMin) return false;
  const horizontalGap = Math.max(
    anchorRect.left - targetRect.right,
    targetRect.left - anchorRect.right,
    0
  );
  if (horizontalGap > attachRange) return false;
  return true;
}

function isVerticalNeighbour(anchorRect         , targetRect         , overlapMin        , attachRange        )          {
  const horizontalOverlap =
    Math.min(anchorRect.right, targetRect.right) -
    Math.max(anchorRect.left, targetRect.left);
  if (horizontalOverlap < overlapMin) return false;
  const verticalGap = Math.max(
    anchorRect.top - targetRect.bottom,
    targetRect.top - anchorRect.bottom,
    0
  );
  return verticalGap <= attachRange;
}

// \u2500\u2500\u2500 Path helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function roundRectPath(
  ctx                          ,
  x        ,
  y        ,
  w        ,
  h        ,
  r        
)       {
  const rr = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const native = (ctx       ).roundRect;
  if (typeof native === 'function') {
    native.call(ctx, x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

// \u2500\u2500\u2500 Draw source (mirror flip) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

                          
            
            
            
            
                 
                 
 

function drawSource(
  ctx                          ,
  src                   ,
  sw        ,
  sh        ,
  dst         
)       {
  if (!dst.flipX && !dst.flipY) {
    ctx.drawImage(src, 0, 0, sw, sh, dst.x, dst.y, dst.w, dst.h);
    return;
  }
  ctx.save();
  if (dst.flipX) {
    ctx.translate(dst.x + dst.w, 0);
    ctx.scale(-1, 1);
  }
  if (dst.flipY) {
    ctx.translate(0, dst.y + dst.h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(
    src,
    0,
    0,
    sw,
    sh,
    dst.flipX ? 0 : dst.x,
    dst.flipY ? 0 : dst.y,
    dst.w,
    dst.h
  );
  ctx.restore();
}

// \u2500\u2500\u2500 Clip + compositing passes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

                          
            
            
            
            
            
 

const FILL_BLUR_CSS_PX = 4;

function fillRingClip(
  ctx                          ,
  x        , y        , w        , h        ,
  radiusDevPx        , bandDevPx        
)       {
  if (w <= 2 * bandDevPx || h <= 2 * bandDevPx) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, radiusDevPx);
    ctx.clip();
    return;
  }
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radiusDevPx);
  roundRectPath(ctx, x + bandDevPx, y + bandDevPx, w - 2 * bandDevPx, h - 2 * bandDevPx, Math.max(0, radiusDevPx - bandDevPx));
  ctx.clip('evenodd');
}

function maskedFillPasses(
  ctx                          ,
  src                   ,
  sw        , sh        ,
  tw        , th        ,
  totalAlpha        ,
  grad                ,
  dst         ,
  fillBox         ,
  dpr        
)       {
  const fillBandDevPx = Math.max(1, Math.round((RANGE_PX + FILL_BLUR_CSS_PX * 3) * dpr));
  let remaining = Math.max(0, totalAlpha);
  let firstChunk = true;
  for (let i = 0; i < 3 && remaining > 1e-4; i++) {
    const a = Math.min(1, remaining);
    ctx.save();
    fillRingClip(ctx, fillBox.x, fillBox.y, fillBox.w, fillBox.h, fillBox.r, fillBandDevPx);
    ctx.globalCompositeOperation = firstChunk ? 'source-over' : 'lighter';
    firstChunk = false;
    ctx.globalAlpha = a;
    drawSource(ctx, src, sw, sh, dst);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);
    ctx.restore();
    remaining -= a;
  }
}

function insideStrokeEvenOddClip(
  ctx                          ,
  x        , y        , w        , h        ,
  radiusDevPx        , strokeDevPx        
)       {
  const r = strokeDevPx | 0;
  if (r < 1 || w <= 2 * r || h <= 2 * r) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, radiusDevPx);
    ctx.clip();
    return;
  }
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radiusDevPx);
  roundRectPath(ctx, x + r, y + r, w - 2 * r, h - 2 * r, Math.max(0, radiusDevPx - r));
  ctx.clip('evenodd');
}

function maskedStrokePasses(
  ctx                          ,
  src                   ,
  sw        , sh        ,
  tw        , th        ,
  strokeBox         ,
  intensity        ,
  strokeBandPx        ,
  grad                ,
  strokeExtraAlpha        ,
  dst         
)       {
  let remaining = intensity * strokeExtraAlpha;
  let firstChunk = true;
  for (let i = 0; i < 3 && remaining > 1e-4; i++) {
    const a = Math.min(1, remaining);
    ctx.save();
    insideStrokeEvenOddClip(ctx, strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, strokeBox.r, strokeBandPx);
    ctx.globalCompositeOperation = firstChunk ? 'source-over' : 'lighter';
    firstChunk = false;
    ctx.globalAlpha = a;
    drawSource(ctx, src, sw, sh, dst);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);
    ctx.restore();
    remaining -= a;
  }
}

function drawBorderHighlight(
  ctx                          ,
  strokeBox         ,
  strokeDevPx        ,
  g0x        , g0y        ,
  g1x        , g1y        ,
  alpha        
)       {
  const grad = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
  grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
  grad.addColorStop(0.5, `rgba(255,255,255,${(alpha * 0.45).toFixed(3)})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.save();
  insideStrokeEvenOddClip(ctx, strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, strokeBox.r, strokeDevPx);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = strokeDevPx * 2;
  ctx.strokeStyle = grad;
  ctx.beginPath();
  roundRectPath(ctx, strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, strokeBox.r);
  ctx.stroke();
  ctx.restore();
}

return { shortestRectDistance, isHorizontalNeighbour, isVerticalNeighbour, roundRectPath, drawSource, maskedFillPasses, maskedStrokePasses, drawBorderHighlight };
})();

// ---- src/engine/reflection/observers.ts
__M["src/engine/reflection/observers.ts"] = (function(){

/**
 * Style observation for reflection targets.
 *
 * Reads corner radii and hairline specs from computed styles, and
 * attaches ResizeObserver / MutationObserver so values stay fresh
 * without per-frame getComputedStyle calls.
 */


function readCornerRadius(el             )         {
  const cs = getComputedStyle(el);
  const radii = [
    parseFloat(cs.borderTopLeftRadius) || 0,
    parseFloat(cs.borderTopRightRadius) || 0,
    parseFloat(cs.borderBottomRightRadius) || 0,
    parseFloat(cs.borderBottomLeftRadius) || 0,
  ].filter((v) => v > 0);
  return radii.length ? Math.min.apply(null, radii) : 0;
}

/**
 * Read the visible "hairline" geometry of the host so the 1-px stroke
 * reflection sits exactly on the host's existing ring.
 *
 * Returns the visible thickness (`width`) and the OUTWARD extent past the
 * padding-box edge (`outerCssPx`) \u2014 the wrap is overscanned by `outerCssPx`
 * on every side so its outer rim lines up with the host's visible silhouette.
 *
 * Source contributions:
 *   - CSS `border-*-width` (max across the 4 sides)
 *   - smallest `inset` `box-shadow` with spread > 0
 *   - smallest outset `box-shadow` with spread > 0
 */
function readHairlineSpec(el             )                                        {
  const cs = getComputedStyle(el);
  const borderMax = Math.max(
    parseFloat(cs.borderTopWidth) || 0,
    parseFloat(cs.borderRightWidth) || 0,
    parseFloat(cs.borderBottomWidth) || 0,
    parseFloat(cs.borderLeftWidth) || 0
  );

  let smallestInsetSpread = 0;
  let smallestOutsetSpread = 0;
  const shadow = cs.boxShadow;
  if (shadow && shadow !== 'none') {
    const safe = shadow.replace(/rgba?\([^)]*\)/g, (m) => m.replace(/,/g, '\u0000'));
    const parts = safe.split(/,\s*/);
    let inset = Infinity;
    let outset = Infinity;
    for (const part of parts) {
      const nums = part.match(/-?\d+(?:\.\d+)?px/g);
      if (!nums || nums.length < 4) continue;
      const spread = parseFloat(nums[3]);
      if (!(spread > 0)) continue;
      if (/\binset\b/.test(part)) {
        if (spread < inset) inset = spread;
      } else if (spread < outset) {
        outset = spread;
      }
    }
    if (Number.isFinite(inset)) smallestInsetSpread = inset;
    if (Number.isFinite(outset)) smallestOutsetSpread = outset;
  }

  const outerCssPx = Math.max(borderMax, smallestOutsetSpread);
  const width =
    Math.max(borderMax, smallestInsetSpread, smallestOutsetSpread) || 1;

  return { width, outerCssPx };
}

function refreshTargetStyles(t                  )       {
  t.cornerRadius = readCornerRadius(t.el);
  const spec = readHairlineSpec(t.el);
  t.hairlineWidth = spec.width;
  t.hairlineOuterCssPx = spec.outerCssPx;
}

function attachObservers(t                  )       {
  if (typeof ResizeObserver !== 'undefined') {
    t.resizeObserver = new ResizeObserver(() => refreshTargetStyles(t));
    t.resizeObserver.observe(t.el);
  }
  if (typeof MutationObserver !== 'undefined') {
    t.mutationObserver = new MutationObserver(() => refreshTargetStyles(t));
    t.mutationObserver.observe(t.el, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }
}

function detachObservers(t                  )       {
  t.resizeObserver?.disconnect();
  t.resizeObserver = null;
  t.mutationObserver?.disconnect();
  t.mutationObserver = null;
}

return { readCornerRadius, readHairlineSpec, attachObservers, detachObservers };
})();

// ---- src/engine/reflection/paint.ts
__M["src/engine/reflection/paint.ts"] = (function(){
const { ATTACH_RANGE_PX, BASE_ALPHA, BOOST_ALPHA, BORDER_HILITE_ALPHA, BORDER_HILITE_PX, FILL_CIRCLE_ATTENUATION, FILL_EXTRA_ALPHA, FILL_OPACITY_MUL, GLOBAL_ATTENUATION, GRAD_FAR, GRAD_MID, GRAD_NEAR, OVERLAP_MIN_PX, INTENSITY_MULT, MAX_ALPHA_STACK, RANGE_PX, REF_DRAW_CSS_W, REFLECTION_BLOCKED_TAGS, STROKE_CSS_PX, STROKE_EXTRA_ALPHA } = __M["src/engine/reflection/constants.ts"];
const { drawBorderHighlight, isHorizontalNeighbour, isVerticalNeighbour, maskedFillPasses, maskedStrokePasses, shortestRectDistance } = __M["src/engine/reflection/geometry.ts"];
const { attachObservers, detachObservers, readCornerRadius, readHairlineSpec } = __M["src/engine/reflection/observers.ts"];
/** Proximity reflection \u2014 public API and per-frame paint loop. */






const targets                        = new Set();

function addReflectionTarget(
  el             ,
  anchor                 ,
  anchorEl             
)                          {
  if (typeof document === 'undefined') return null;
  if (REFLECTION_BLOCKED_TAGS.has(el.tagName)) return null;
  for (const existing of targets) {
    if (existing.el === el) return existing;
  }

  const wrap = document.createElement('div');
  wrap.setAttribute('data-metal-fx-reflection', '');
  wrap.setAttribute('aria-hidden', 'true');

  const canvas = document.createElement('canvas');
  canvas.className = 'metal-fx-reflection-canvas';
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;

  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.className = 'metal-fx-reflection-stroke-canvas';
  const strokeCtx = strokeCanvas.getContext('2d', { alpha: true });
  if (!strokeCtx) return null;

  wrap.appendChild(canvas);
  wrap.appendChild(strokeCanvas);

  const cs = getComputedStyle(el);
  let appliedPositionRelative = false;
  if (cs.position === 'static') {
    el.style.position = 'relative';
    appliedPositionRelative = true;
  }
  let appliedIsolation = false;
  if (cs.isolation !== 'isolate') {
    el.style.isolation = 'isolate';
    appliedIsolation = true;
  }
  el.setAttribute('data-metal-fx-reflect-host', '');
  el.insertBefore(wrap, el.firstChild);

  const initialSpec = readHairlineSpec(el);
  const target                   = {
    el,
    anchor,
    anchorEl,
    wrap,
    canvas,
    ctx,
    strokeCanvas,
    strokeCtx,
    cornerRadius: readCornerRadius(el),
    hairlineWidth: initialSpec.width,
    hairlineOuterCssPx: initialSpec.outerCssPx,
    appliedPositionRelative,
    appliedIsolation,
    resizeObserver: null,
    mutationObserver: null,
  };
  attachObservers(target);
  targets.add(target);
  return target;
}

function removeReflectionTarget(el             )       {
  for (const target of targets) {
    if (target.el === el) {
      detachObservers(target);
      target.canvas.width = 0;
      target.canvas.height = 0;
      target.strokeCanvas.width = 0;
      target.strokeCanvas.height = 0;
      if (target.wrap.parentNode === target.el) {
        target.el.removeChild(target.wrap);
      }
      target.el.removeAttribute('data-metal-fx-reflect-host');
      if (target.appliedPositionRelative) target.el.style.position = '';
      if (target.appliedIsolation) target.el.style.isolation = '';
      targets.delete(target);
      return;
    }
  }
}

function paintReflections()       {
  if (targets.size === 0) return;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const anchorRects = new Map                      ();

  for (const t of targets) {
    const tRect = t.el.getBoundingClientRect();
    let aRect = anchorRects.get(t.anchorEl);
    if (!aRect) {
      aRect = t.anchorEl.getBoundingClientRect();
      anchorRects.set(t.anchorEl, aRect);
    }
    if (tRect.width < 1 || tRect.height < 1) continue;
    if (aRect.width < 1 || aRect.height < 1) continue;

    if (
      !isHorizontalNeighbour(aRect, tRect, OVERLAP_MIN_PX, ATTACH_RANGE_PX) &&
      !isVerticalNeighbour(aRect, tRect, OVERLAP_MIN_PX, ATTACH_RANGE_PX)
    ) {
      if (t.canvas.width !== 1) { t.canvas.width = 1; t.canvas.height = 1; }
      if (t.strokeCanvas.width !== 1) { t.strokeCanvas.width = 1; t.strokeCanvas.height = 1; }
      continue;
    }

    const anchorCanvas = t.anchor.canvas;
    const sw = anchorCanvas.width | 0;
    const sh = anchorCanvas.height | 0;
    if (sw < 4 || sh < 4) continue;

    const acx = (aRect.left + aRect.right) * 0.5;
    const acy = (aRect.top + aRect.bottom) * 0.5;
    const tcx = (tRect.left + tRect.right) * 0.5;
    const tcy = (tRect.top + tRect.bottom) * 0.5;
    const dx = acx - tcx;
    const dy = acy - tcy;

    const edgeGapH = Math.max(aRect.left - tRect.right, tRect.left - aRect.right, 0);
    const edgeGapV = Math.max(aRect.top - tRect.bottom, tRect.top - aRect.bottom, 0);
    const isHorizontalLayout = edgeGapH >= edgeGapV;

    const dist = shortestRectDistance(aRect, tRect);
    let proximity = 1 - Math.min(1, dist / RANGE_PX);
    proximity = proximity * proximity * (3 - 2 * proximity);
    const intensity = BASE_ALPHA + (BOOST_ALPHA - BASE_ALPHA) * proximity;

    const reflectionAlpha = Math.min(
      MAX_ALPHA_STACK,
      intensity * INTENSITY_MULT * GLOBAL_ATTENUATION
    );

    // Effective scale of the host element. Anything drawn on the reflection
    // canvas (strokes, border-highlight) is in DEVICE pixels, so it doesn't
    // automatically grow when the host is rendered at non-1\u00d7 layout (CSS
    // zoom: 2, etc.). Multiply absolute-pixel constants by the anchor's
    // scale so the reflection scales together with the metal effect itself.
    const sScale = t.anchor.scale ?? 1;
    const hairlineCssPx = Math.max(STROKE_CSS_PX * sScale, t.hairlineWidth);
    const strokeBandPx = Math.max(1, Math.round(hairlineCssPx * dpr));
    const borderHighlightPx = Math.max(
      1,
      Math.round(Math.max(BORDER_HILITE_PX * sScale, t.hairlineWidth) * dpr)
    );

    const overscanCssPx = t.hairlineOuterCssPx;
    t.wrap.style.inset = `${-overscanCssPx}px`;
    t.wrap.style.borderRadius = `${Math.max(0, t.cornerRadius)}px`;

    const tw = Math.max(1, Math.round((tRect.width + overscanCssPx * 2) * dpr));
    const th = Math.max(1, Math.round((tRect.height + overscanCssPx * 2) * dpr));
    if (t.canvas.width !== tw) t.canvas.width = tw;
    if (t.canvas.height !== th) t.canvas.height = th;
    if (t.strokeCanvas.width !== tw) t.strokeCanvas.width = tw;
    if (t.strokeCanvas.height !== th) t.strokeCanvas.height = th;

    const ctx = t.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tw, th);
    const strokeCtx = t.strokeCtx;
    strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    strokeCtx.clearRect(0, 0, tw, th);

    const bandDevPx = Math.min(RANGE_PX * dpr, Math.max(tw, th));
    let g0x        , g0y        , g1x        , g1y        ;
    if (isHorizontalLayout) {
      g0x = dx > 0 ? tw : 0; g1x = dx > 0 ? tw - bandDevPx : bandDevPx;
      g0y = th * 0.5; g1y = th * 0.5;
    } else {
      g0y = dy > 0 ? th : 0; g1y = dy > 0 ? th - bandDevPx : bandDevPx;
      g0x = tw * 0.5; g1x = tw * 0.5;
    }
    const grad = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
    grad.addColorStop(0, `rgba(0,0,0,${GRAD_NEAR})`);
    grad.addColorStop(0.5, `rgba(0,0,0,${GRAD_MID})`);
    grad.addColorStop(1, `rgba(0,0,0,${GRAD_FAR})`);

    const anchorCssW = sw / dpr;
    const refWdpr = Math.max(1, Math.round(REF_DRAW_CSS_W * Math.max(0.1, anchorCssW / 140) * dpr));

    let drawX        , drawY        , drawW        , drawH        ;
    let flipX = false, flipY = false;
    if (isHorizontalLayout) {
      const overlapTop = Math.max(aRect.top, tRect.top);
      const overlapBot = Math.min(aRect.bottom, tRect.bottom);
      flipX = true;
      drawX = dx > 0 ? tw - refWdpr : 0;
      drawY = Math.round((overlapTop - tRect.top + overscanCssPx) * dpr);
      drawW = refWdpr;
      drawH = Math.max(1, Math.round((overlapBot - overlapTop) * dpr));
    } else {
      const overlapLeft = Math.max(aRect.left, tRect.left);
      const overlapRight = Math.min(aRect.right, tRect.right);
      flipY = true;
      drawX = Math.round((overlapLeft - tRect.left + overscanCssPx) * dpr);
      drawY = dy > 0 ? th - refWdpr : 0;
      drawW = Math.max(1, Math.round((overlapRight - overlapLeft) * dpr));
      drawH = refWdpr;
    }
    const drawDst          = { x: drawX, y: drawY, w: drawW, h: drawH, flipX, flipY };

    const strokeBox          = { x: 0, y: 0, w: tw, h: th, r: Math.max(0, t.cornerRadius * dpr) };

    const fillReflectionAlpha = Math.min(
      MAX_ALPHA_STACK,
      reflectionAlpha * FILL_EXTRA_ALPHA * FILL_OPACITY_MUL * FILL_CIRCLE_ATTENUATION
    );
    maskedFillPasses(ctx, anchorCanvas, sw, sh, tw, th, fillReflectionAlpha, grad, drawDst, strokeBox, dpr);

    maskedStrokePasses(
      strokeCtx, anchorCanvas, sw, sh, tw, th,
      strokeBox, reflectionAlpha, strokeBandPx, grad, STROKE_EXTRA_ALPHA, drawDst
    );

    drawBorderHighlight(
      strokeCtx, strokeBox, borderHighlightPx,
      g0x, g0y, g1x, g1y,
      Math.min(0.85, BORDER_HILITE_ALPHA * reflectionAlpha)
    );

    ctx.globalCompositeOperation = 'source-over';
    strokeCtx.globalCompositeOperation = 'source-over';
  }
}

return { addReflectionTarget, removeReflectionTarget, paintReflections };
})();

// ---- src/engine/reflection/reflectionScheduler.ts
__M["src/engine/reflection/reflectionScheduler.ts"] = (function(){
const { REFLECTION_INTERVAL_MS } = __M["src/engine/perfConfig.ts"];
const { paintReflections } = __M["src/engine/reflection/paint.ts"];
/**
 * Auxiliary RAF driver for *target-side* work (currently: dark-mode reflections).
 *
 * Reflections run at 15 fps \u2014 the CSS blur(4px) on the fill canvas hides
 * temporal stepping completely. The scheduler coalesces rapid calls and
 * skips frames that arrive faster than the target interval.
 */


let scheduled = false;
let lastReflectionMs = 0;

function scheduleReflectionPaint()       {
  if (scheduled) return;
  scheduled = true;
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame((now) => {
    scheduled = false;
    if (now - lastReflectionMs < REFLECTION_INTERVAL_MS) return;
    lastReflectionMs = now;
    paintReflections();
  });
}

return { scheduleReflectionPaint };
})();

// ---- src/styles.ts
__M["src/styles.ts"] = (function(){

const STYLE_ID = 'metal-fx-styles';

const CSS = /* css */ `
.metal-fx-root {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  isolation: isolate;
  overflow: visible;
  background: #272727;
  color: #f8f8f8;
}
.metal-fx-root[data-theme='light'] {
  background: #ffffff;
  color: #1d1d1d;
}

.metal-fx-root::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 2;
  box-shadow: inset 0 0 50px 0 rgba(255, 255, 255, 0.02);
}
.metal-fx-root[data-theme='light']::before {
  box-shadow: inset 0 0 50px 0 rgba(0, 0, 0, 0.02);
}

.metal-fx-root::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 4;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
.metal-fx-root[data-theme='light']::after {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}
/* Circle variant gets a thicker outer rim than the button variant. */
.metal-fx-root[data-variant='circle']::after {
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.1);
}
.metal-fx-root[data-theme='light'][data-variant='circle']::after {
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.06);
}

.metal-fx-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
  border-radius: inherit;
}

/* The inner spacer \u2014 defines the inset geometry where the metal ring meets
   the interior (3 px for Button, 1-2 px for Circle) and carries the Circle dark
   hairline ('box-shadow: inset' rules below). Intentionally transparent so
   the wrapper's background propagates through to the punched shader centre,
   giving consumers a single surface tone to override. See "Single-surface
   background" in the file header for the rationale. */
.metal-fx-inner {
  position: absolute;
  inset: 3px;
  border-radius: inherit;
  z-index: 1;
  pointer-events: none;
}

.metal-fx-root[data-variant='button'][data-shape='pill'] .metal-fx-inner {
  border-radius: calc(var(--mfx-radius, 20px) - 3px);
}
.metal-fx-root[data-variant='button'][data-shape='circle'] .metal-fx-inner {
  border-radius: calc(var(--mfx-radius, 16px) - 3px);
}
.metal-fx-root[data-variant='circle'][data-shape='pill'] .metal-fx-inner {
  inset: 0;
  border-radius: var(--mfx-radius, 20px);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}
.metal-fx-root[data-variant='circle'][data-shape='circle'] .metal-fx-inner {
  inset: 0;
  border-radius: var(--mfx-radius, 16px);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}
/* Circle-variant hairline alpha \u2014 light mode.
   Source-of-truth: index.html L2261-2267. The 0.45-alpha black inset that
   reads as a single-pixel frame against the dark interior is too heavy
   on a #ffffff inner: it ends up looking like a hard 2-px black ring
   against the iridescent shader. Suppressed entirely (alpha 0) \u2014 the
   shader's own iridescent rim already defines the silhouette in light
   mode, so an extra dark hairline only competes with it. The rule is
   kept (rather than deleted) as a tunable hook in case a future variant
   wants to re-introduce a soft edge. NOTE: we keep the dark-mode inset
   and border-radius values because \u2014 unlike index.html \u2014 our renderer
   does NOT overscan the canvas in light mode, so there is no 1-px gap
   between inner element and shader to compensate for. */
.metal-fx-root[data-theme='light'][data-variant='circle'][data-shape='pill'] .metal-fx-inner,
.metal-fx-root[data-theme='light'][data-variant='circle'][data-shape='circle'] .metal-fx-inner {
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0);
}

/* \u2500\u2500\u2500 Combined glow SVG (z=3) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Single SVG per instance that holds BOTH the wide-halo group
   (#mfx_haloTravel) and the catch-light group (#mfx_extraTravel), exactly
   mirroring canonical's _buildGlowSvgInner (index.html L8078). One
   mix-blend-mode: screen lifts the combined composite onto the shader
   ring; per-frame opacity attributes on each inner group still drive the
   independent fade-in / fade-out cycles for the halo and the catch-light.

   Why a single SVG: the circle variant anchors halo + catch-light at the same
   perimeter point, so they overlap in the bright zone. Two separately-
   screened SVGs would double-screen the overlap (A + B + C - AB - AC -
   BC + ABC instead of A + B + C - AB - AC once both groups composite
   in source-over inside one SVG and then screen against the host once).
   That overlap looked muted versus canonical specifically on the circle
   variant where both layers travel together.

   Source-of-truth opacity: #btnGlowSvg drops to 0.7 in dark and 0.2746 in
   light (index.html L632/L643). */
.metal-fx-glow-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  z-index: 3;
  pointer-events: none;
  opacity: 0.7;
}
.metal-fx-root[data-theme='light'] .metal-fx-glow-svg {
  /* Light-mode 1-px overscan mirrors .btn-glow-svg in metal.html so the
     halo stays glued to the visible silhouette (the shader ring there sits
     1 px outside the host's padding box). */
  inset: -1px;
  width: calc(100% + 2px);
  height: calc(100% + 2px);
  mix-blend-mode: multiply;
  /* Source-of-truth: html[data-theme="light"] #btnGlowSvg { opacity: 0.2746 }
     \u2192 \u221235 % from 0.4225 from the original 0.7 dark-mode opacity. */
  opacity: 0.2746;
  filter: saturate(5.355) brightness(0.78);
}
/* Circle light-mode small variants (e.g. 36\u00d736 send button): the geometrically
   shrunk halo loses density when multiplied against #ffffff. Mirror the
   canonical override at index.html L2316 \u2014 bump saturation + drop brightness
   so the small glow holds together visually. */
.metal-fx-root[data-variant='circle'][data-shape='circle'][data-theme='light'] .metal-fx-glow-svg {
  filter: saturate(7.5) brightness(0.6);
}

/* The wrapped child \u2014 hoisted into z=5 so it sits above every overlay, with
   normalized chrome so consumer button styles don't fight the metal frame. */
.metal-fx-content {
  position: relative;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  pointer-events: none;
}
.metal-fx-content > * {
  pointer-events: auto;
}
.metal-fx-root[data-normalize='true'] .metal-fx-content > * {
  background: transparent !important;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  /* Sizing: we deliberately DO NOT force \`width: 100%; height: 100%\` on the
     child here. That used to be the contract ("the wrapper is the visible
     button surface; the child stretches to fill it"), but it created a cyclic
     percentage dependency: the wrapper is \`inline-flex\` with no intrinsic
     size, .metal-fx-content is \`width/height: 100%\` of the wrapper, and the
     child was \`100%\` of .metal-fx-content. With nothing breaking the cycle,
     icon-only / class-sized children collapsed.

     The new contract: the child sizes itself (intrinsic content, CSS class,
     or inline style \u2014 all work), and the wrapper's \`inline-flex\` wraps it
     tightly. Consumers who want a metal frame BIGGER than the child (e.g.
     padding around an icon) size <MetalFx style={{ width, height }}> AND
     explicitly set width/height on the child to fill (or accept that the
     child renders at its intrinsic size, centered).

     Typography is intentionally NOT touched. We used to apply
     \`color: inherit; font: inherit;\` here to "match" the wrapper, but
     \`font: inherit\` is a shorthand that overrides font-family, font-size,
     font-weight, AND line-height on the child \u2014 which (a) shrank the
     button height (line-height changes propagate through the flex
     content box) and (b) scaled em-based icons / font-icons inside the
     child to whatever the wrapper inherited. The wrapper now stays out
     of the child's typography entirely; consumers who want typographic
     normalization can apply it themselves on the child element. */
}

[data-metal-fx-reflection] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  overflow: hidden;
  z-index: 0;
  isolation: isolate;
}
.metal-fx-reflection-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  filter: blur(4px) saturate(1.2) brightness(1.58);
}
.metal-fx-reflection-stroke-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  filter: saturate(1.35) brightness(1.75);
}
/* Hosts that participate as reflection targets need positioning + isolation
   so the wrap composites only against the host (not the parent stack). The
   wrap injects these inline as well, but stating them here keeps reflections
   working on hosts that already have other inline styles applied. */
[data-metal-fx-reflect-host] {
  isolation: isolate;
}
`;

let injected = false;

function ensureStylesInjected()       {
  if (injected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { injected = true; return; }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}

return { ensureStylesInjected };
})();

window.MetalFxEngine = Object.assign({}, __M['src/engine/renderer/loop.ts'], __M['src/engine/glow/glow.ts'], __M['src/engine/reflection/paint.ts'], __M['src/engine/reflection/reflectionScheduler.ts'], __M['src/styles.ts']);

})();
