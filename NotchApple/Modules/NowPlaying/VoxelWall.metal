//
//  VoxelWall.metal
//  Notch Apple
//
//  The Voxel Wall scenes (issue #119), drawn per pixel by the GPU as a SwiftUI colour effect. Each scene is a world of voxel
//  columns or blocks, seen in perspective, that moves with the music's four bands (bass, low-mids, mids, highs):
//    0 Voxel Field     a rolling landscape of square columns; bass lifts waves through it, highs sparkle on the peaks
//    1 Spike Field     the same lattice, sharper: single columns shoot up with the beat
//    2 Infinite Tunnel a tunnel of voxel blocks rushing past; the bass pushes the speed and the walls breathe
//    3 Voxel City      a skyline of blocks under a moving camera; windows flicker with the highs
//  Rendering: a grid ray-walk (DDA) through the height field, so every column is a real box with a lit top, shaded sides,
//  seams between stacked cubes, and fog into the distance.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float vwHash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

static float vwNoise(float2 p) {
    float2 i = floor(p), f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = vwHash(i), b = vwHash(i + float2(1, 0)), c = vwHash(i + float2(0, 1)), d = vwHash(i + float2(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/// Height of the column in cell `c` (world units; one cube is 0.5 tall).
static float vwHeight(float2 c, float t, float4 bands, float scene, float intensity) {
    float n = vwNoise(c * 0.085 + float2(t * 0.11, t * 0.05));
    float n2 = vwNoise(c * 0.23 - float2(t * 0.2, 0.0));
    float wave = 0.5 + 0.5 * sin(c.x * 0.32 + c.y * 0.12 + t * 1.6);
    float swell = 0.5 + 0.5 * sin(length(c - float2(0.0, t * 2.2 + 30.0)) * 0.22 - t * 3.0);
    float h;
    if (scene > 2.5) {                                                   // Voxel City: blocks of buildings
        float2 block = floor(c / 3.0);
        float b = vwHash(block);
        float street = (fmod(abs(c.x), 3.0) < 1.0 || fmod(abs(c.y), 3.0) < 1.0) ? 0.0 : 1.0;
        h = street * (0.6 + pow(b, 2.0) * 6.0 * (0.75 + 0.5 * bands.x * intensity));
    } else if (scene > 0.5) {                                            // Spike Field
        float spike = pow(vwHash(c + floor(t * 3.0)), 14.0) * (2.5 + 7.0 * bands.x * intensity);
        h = 0.25 + n * n * 1.6 + spike + bands.y * intensity * wave * 1.2;
    } else {                                                             // Voxel Field
        float n3 = vwNoise(c * 0.04 + float2(-t * 0.06, t * 0.04));
        h = 0.3 + n3 * 3.0 + n * n * 2.2 + intensity * (bands.x * 3.4 * swell * (0.4 + n3) + bands.y * 1.4 * wave + bands.z * 0.8 * n2);
    }
    return floor(h * 2.0) * 0.5 + 0.5;                                   // stacked half-unit cubes
}

static float3 vwPalette(float x, float3 a, float3 b) {
    x = clamp(x, 0.0, 1.0);
    return mix(a * 0.35, mix(a, b, smoothstep(0.35, 1.0, x)), smoothstep(0.0, 0.5, x));
}

/// The field scenes (0, 1, 3): a ray-walk across the grid until the ray meets a column.
static float3 vwField(float2 uv, float t, float4 bands, float scene, float intensity, float3 colA, float3 colB) {
    bool city = scene > 2.5;
    float3 ro = float3(sin(t * 0.07) * 9.0, city ? 13.0 : 17.0, t * (city ? 2.2 : 3.4));
    float3 fwd = normalize(float3(sin(t * 0.05) * 0.25, city ? -0.45 : -0.62, 1.0));
    float3 right = normalize(cross(float3(0, 1, 0), fwd));
    float3 up = cross(fwd, right);
    float fov = city ? 0.95 : 1.35;
    float3 rd = normalize(fwd + uv.x * right * fov + uv.y * up * fov);
    float3 sky = mix(colA * 0.08, colB * 0.12, smoothstep(-0.3, 0.6, uv.y)) + 0.015;
    if (rd.y > -0.01) return sky;

    float2 cell = floor(ro.xz);
    float2 stepv = sign(rd.xz);
    float2 tDelta = abs(1.0 / rd.xz);
    float2 tMax = ((cell + max(stepv, 0.0)) - ro.xz) / rd.xz;
    float tPrev = 0.0;
    int axis = 0;
    for (int i = 0; i < 160; i++) {
        float h = vwHeight(cell, t, bands, scene, intensity);
        float tNext = min(tMax.x, tMax.y);
        float yEnter = ro.y + rd.y * tPrev, yExit = ro.y + rd.y * tNext;
        if (yExit <= h) {
            bool side = yEnter <= h && i > 0;
            float th = side ? tPrev : (h - ro.y) / rd.y;
            float3 p = ro + rd * th;
            float k = h / (city ? 6.0 : 6.5);
            float3 base = vwPalette(k, colA, colB);
            float3 col;
            if (side) {
                float seam = smoothstep(0.0, 0.06, fract(p.y * 2.0)) * smoothstep(0.0, 0.06, 1.0 - fract(p.y * 2.0));
                float edge = axis == 0 ? fract(p.z) : fract(p.x);
                float vline = smoothstep(0.0, 0.05, edge) * smoothstep(0.0, 0.05, 1.0 - edge);
                col = base * (axis == 0 ? 0.42 : 0.62) * (0.55 + 0.45 * seam * vline);
                if (city && vwHash(float2(floor((axis == 0 ? p.z : p.x) * 2.0), floor(p.y * 2.0)) + cell * 7.0) > 0.82 - bands.w * 0.3) col += colB * 0.5;   // lit windows
            } else {
                float2 f = fract(p.xz);
                float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
                col = base * (0.85 + 0.35 * k) * (0.6 + 0.4 * smoothstep(0.0, 0.07, edge));
                float sparkle = step(0.9, vwHash(cell + floor(t * 6.0))) * smoothstep(0.55, 0.9, k) * bands.w * intensity;
                col += float3(1.0) * sparkle * 1.4;
            }
            float fog = exp(-th * 0.022);
            return mix(sky, col, fog);
        }
        tPrev = tNext;
        if (tMax.x < tMax.y) { tMax.x += tDelta.x; cell.x += stepv.x; axis = 0; }
        else { tMax.y += tDelta.y; cell.y += stepv.y; axis = 1; }
        if (tPrev > 120.0) break;
    }
    return sky;
}

/// Infinite Tunnel: blocks on the walls of a square tunnel, rushing towards you.
static float3 vwTunnel(float2 uv, float t, float4 bands, float intensity, float3 colA, float3 colB) {
    float speed = t * (3.0 + bands.x * intensity * 2.0);
    float r = max(abs(uv.x), abs(uv.y));                                 // square tunnel
    float z = 0.45 / max(r, 0.02) + speed;
    float side = abs(uv.x) > abs(uv.y) ? (uv.x > 0 ? 0.0 : 1.0) : (uv.y > 0 ? 2.0 : 3.0);
    float along = (abs(uv.x) > abs(uv.y) ? uv.y / abs(uv.x) : uv.x / abs(uv.y)) * 6.0;
    float2 cell = float2(floor(along), floor(z * 2.0));
    float bump = vwHash(cell + side * 31.0);
    float pulse = bands.y * intensity * (0.5 + 0.5 * sin(cell.y * 0.7 + t * 4.0));
    float lit = smoothstep(0.55 - pulse * 0.4, 1.0, bump);
    float2 f = float2(fract(along), fract(z * 2.0));
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float3 col = vwPalette(0.25 + bump * 0.75 * (0.6 + pulse), colA, colB) * (0.35 + 0.65 * smoothstep(0.0, 0.08, edge));
    col += colB * lit * (0.25 + bands.w * intensity * 0.8);
    float depthFade = smoothstep(0.0, 0.45, r);
    return col * depthFade + colA * 0.25 * (1.0 - depthFade) * (0.5 + bands.x);
}

[[ stitchable ]] half4 voxelWall(float2 position, half4 color, float2 size, float time, float4 bands, float scene, float intensity, half4 a, half4 b) {
    float2 uv = (position - size * 0.5) / size.y;
    uv.y = -uv.y;
    float3 colA = float3(a.rgb), colB = float3(b.rgb);
    float3 rgb = scene > 1.5 && scene < 2.5 ? vwTunnel(uv, time, bands, intensity, colA, colB)
                                             : vwField(uv, time, bands, scene, intensity, colA, colB);
    float vignette = smoothstep(1.25, 0.35, length(uv * float2(0.85, 1.1)));
    rgb *= 0.55 + 0.45 * vignette;
    return half4(half3(clamp(rgb, 0.0, 1.0)), 1.0h);
}

/// Film grain over the lyrics (VoxelVerse look): a fine moving noise, strongest in the dark parts.
[[ stitchable ]] half4 voxelGrain(float2 position, half4 color, float time, float amount) {
    float n = vwHash(floor(position) + floor(time * 24.0) * 17.0) - 0.5;
    float3 c = float3(color.rgb) + n * amount;
    return half4(half3(clamp(c, 0.0, 1.0)), color.a);
}
