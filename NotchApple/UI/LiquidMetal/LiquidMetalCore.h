//
//  LiquidMetalCore.h
//  Notch Apple
//
//  The liquid-metal look as one plain Metal function, shared by the SwiftUI shader (LiquidMetal.metal). Matched to the approved
//  browser prototype (docs/prototypes/liquid-metal-notch.html, built from Jakub Antalik's MIT metal-fx): a dark glass body, a thin
//  smooth metallic ring whose bright arcs slowly flow around the edge, and a soft inner glow, all in the theme colour.
//  Procedural: nothing is loaded and nothing is sent anywhere.
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
static inline float3 liquidMetalFill(float2 p, float2 size, float t, float3 tint, float hover) {
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


/// A colour from a hue 0...1 (for the Rainbow option).
static inline float3 lm_rainbow(float h) { return clamp(abs(fract(h + float3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }

/// chroma 0: the theme colour; 1: Rainbow (the hue drifts across the metal and over time); 2: Gold; 3: Purple.
static inline float3 liquidMetalTint(float3 theme, float chroma, float2 p, float2 size, float t) {
    if (chroma > 2.5) return float3(0.64, 0.42, 1.0);                          // Purple
    if (chroma > 1.5) return float3(1.0, 0.78, 0.30);
    if (chroma > 0.5) return lm_rainbow(p.x / max(size.x, 1.0) * 0.8 + p.y / max(size.y, 1.0) * 0.2 + t * 0.04);
    return theme;
}

/// mode 0: a resting or hovered button (dark glass, thin ring); 1: the open tab (tinted glass, brighter ring);
/// 2: a rim only (used through a mask around the closed notch). hover 0...1 brightens and speeds up the arcs.
static inline float3 liquidMetalRing(float2 p, float2 size, float t, float3 tint, float hover, float mode) {
    float r = max(min(size.x, size.y) * 0.5, 1.0);
    float2 c = clamp(p, float2(r, r), float2(max(size.x - r, r), r));
    float2 d = p - c;
    float inner = max(r - length(d), 0.0);                       // points in from the edge
    float hue_max = max(max(tint.r, max(tint.g, tint.b)), 0.001);
    float3 hue = tint / hue_max;                                  // the theme colour at full brightness

    // Where we are around the outline, 0...1, so the arcs follow the shape (angle on the round ends, x on the straight sides).
    float ang = atan2(d.y, d.x) / 6.2831853;
    float along = (p.x / max(size.x, 1.0)) * 0.9 + ang * 0.35;
    float phase = along * 2.0 + t * (0.035 + 0.06 * hover);
    // Two soft waves make a few wide bright arcs and long dim gaps: smooth, never speckled.
    float w = 0.5 + 0.5 * sin(phase * 6.2831853 + 1.3 * sin(phase * 6.2831853 * 1.5 + t * 0.4));
    float arc = smoothstep(0.35, 1.0, w);
    float arc2 = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(phase * 6.2831853 * 2.0 - 1.7 + t * 0.3));

    float ringW = (mode > 1.5) ? 99.0 : (1.4 + 0.9 * hover + 0.5 * step(0.5, mode));
    float ring = smoothstep(ringW, ringW * 0.35, inner);
    float glow = exp(-inner / (4.5 + 2.0 * hover));

    float3 silver = mix(hue * 0.35, mix(hue, float3(1.0), 0.62), arc);            // dim metal to a bright, almost white highlight
    silver += float3(1.0) * arc2 * 0.25;
    float level = 0.55 + 0.45 * arc + 0.35 * hover;
    float3 body = float3(0.05, 0.05, 0.07) + hue * 0.05 + float3(0.04) * smoothstep(0.0, r, inner) * (1.0 - float(mode > 1.5));
    if (mode > 0.5 && mode < 1.5) body = mix(body, hue * 0.42 + float3(0.04), 0.85);   // the open tab is filled with the theme colour
    float3 rgb = body + silver * ring * level + hue * glow * (0.10 + 0.5 * arc) * (0.6 + 0.8 * hover);
    if (mode > 1.5) rgb = silver * (0.6 + 0.5 * arc + 0.3 * hover);
    return clamp(rgb, 0.0, 1.0);
}

/// The closed-notch outline: a thin band of liquid chrome, as in the approved prototype. Dark steel and bright silver bands flow along the
/// outline (the silver takes a little of the theme colour), with a fine white glint. Uniform and smooth, no blobs.
static inline float3 liquidMetalChrome(float2 p, float t, float3 tint, float hover) {
    float hue_max = max(max(tint.r, max(tint.g, tint.b)), 0.001);
    float3 hue = tint / hue_max;
    float k = t * (1.1 + 1.0 * hover);                                                   // lively: the bands move quickly
    // Several overlapping waves, so the outline is full of moving bands rather than a few slow ones.
    float s1 = 0.5 + 0.5 * sin(p.x * 0.085 + p.y * 0.09 + k + 1.8 * sin(p.x * 0.021 - k * 0.7));
    float s2 = 0.5 + 0.5 * sin(p.x * 0.047 - p.y * 0.06 - k * 0.8 + 2.0);
    float s3 = 0.5 + 0.5 * sin(p.x * 0.13 + k * 1.3 + p.y * 0.05);
    float band = smoothstep(0.28, 0.72, 0.5 * s1 + 0.3 * s2 + 0.2 * s3);
    float glint = pow(smoothstep(0.55, 1.0, s1), 5.0);
    // A bright highlight that sweeps along the outline.
    float sweep = pow(smoothstep(0.0, 1.0, 1.0 - abs(fract(p.x * 0.0105 - t * 0.55) - 0.5) * 2.0), 6.0);
    float3 steel = float3(0.035, 0.035, 0.055) + hue * 0.03;
    float3 silver = mix(float3(0.90, 0.92, 0.97), hue * 0.85 + 0.15, 0.42);
    float3 rgb = mix(steel, silver, band) + float3(glint) * 0.4 + silver * sweep * 0.6;
    return clamp(rgb, 0.0, 1.0);
}

#endif
