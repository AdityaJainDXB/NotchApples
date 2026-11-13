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

/// mode 0: a resting or hovered button (dark glass, thin ring); 1: the open tab (tinted glass, brighter ring);
/// 2: a rim only (used through a mask around the closed notch). hover 0...1 brightens and speeds up the arcs.
static inline float3 liquidMetalRGB(float2 p, float2 size, float t, float3 tint, float hover, float mode) {
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

#endif
