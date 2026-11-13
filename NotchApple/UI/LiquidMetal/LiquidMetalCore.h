//
//  LiquidMetalCore.h
//  Notch Apple
//
//  The liquid-metal look as one plain Metal function, shared by the SwiftUI shader (LiquidMetal.metal) and by the test
//  program that renders it to a picture. Procedural: nothing is loaded, nothing is sent anywhere. The look follows the
//  approved browser prototype (docs/prototypes/liquid-metal-notch.html, built from Jakub Antalik's MIT metal-fx): a
//  silver body that slowly flows, bright moving highlights, a darker rim, tinted by the theme colour.
//
#ifndef LIQUID_METAL_CORE_H
#define LIQUID_METAL_CORE_H

#include <metal_stdlib>
using namespace metal;

static inline float lm_hash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static inline float lm_noise(float2 p) {
    float2 i = floor(p), f = fract(p);
    float a = lm_hash(i), b = lm_hash(i + float2(1, 0)), c = lm_hash(i + float2(0, 1)), d = lm_hash(i + float2(1, 1));
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

static inline float lm_fbm(float2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * lm_noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
}

/// p: pixel position inside the shape, size: the shape's size in pixels, t: seconds, tint: the theme colour (0...1 rgb),
/// strength: 0 = nothing, 1 = full metal. Returns straight (not premultiplied) colour; the caller applies the shape's alpha.
static inline float3 liquidMetalRGB(float2 p, float2 size, float t, float3 tint, float hover) {
    float2 uv = p / max(size, float2(1.0));
    float aspect = size.x / max(size.y, 1.0);
    float2 q = float2(uv.x * aspect * 0.55, uv.y * 0.9);
    // Two passes of domain warping make the surface look like it flows instead of sliding.
    float2 w = float2(lm_fbm(q + float2(0.0, t * 0.07)), lm_fbm(q + float2(5.2, 1.3) - t * 0.05));
    float h = lm_fbm(q + 0.9 * w + float2(t * 0.03, 0.0));
    // Bands of light and dark, like polished chrome.
    float band = 0.5 + 0.5 * sin(h * 13.0 + w.x * 2.5 + uv.x * 2.4 + uv.y * 3.0 + t * (0.35 + 0.8 * hover));
    float shade = smoothstep(0.30, 0.70, band) * 0.8;
    float3 dark = float3(0.10, 0.11, 0.15), light = float3(0.92, 0.94, 0.98);
    float3 silver = mix(dark, light, shade);
    // A sharp bright highlight that drifts across (stronger on hover).
    float spec = pow(band, 20.0) * (0.5 + 0.6 * hover);
    float sweep = smoothstep(0.0, 1.0, 1.0 - abs(fract(uv.x * 0.9 - t * 0.06 * (1.0 + hover)) - 0.5) * 2.0);
    silver += spec * float3(1.0) * (0.35 + 0.65 * sweep);
    // The theme colour tints the metal without turning it into paint.
    // Strong tint: the metal is the theme's colour (dark tone to bright tone of that colour), with the white highlights kept.
    float3 hue = tint / max(max(tint.r, max(tint.g, tint.b)), 0.001);          // the colour at full brightness
    float lum = dot(silver, float3(0.333));
    float3 coloured = mix(hue * 0.18, hue, smoothstep(0.1, 0.85, lum)) + hue * pow(max(lum - 0.75, 0.0) * 4.0, 1.5) * 0.35 + float3(spec * 0.5);
    float3 tinted = mix(silver, coloured, 0.88);
    // Darker rim near the edges gives it thickness.
    float2 e = min(uv, 1.0 - uv) * float2(min(size.x, size.y) / max(size.x, 1.0), min(size.x, size.y) / max(size.y, 1.0)) * 6.0;
    float rim = smoothstep(0.0, 1.0, min(e.x, e.y) * 4.0);
    return clamp(mix(tinted * 0.55, tinted, rim), 0.0, 1.0);
}

#endif
