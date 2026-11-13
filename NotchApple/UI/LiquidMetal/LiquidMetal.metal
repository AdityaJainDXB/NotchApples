//
//  LiquidMetal.metal
//  Notch Apple
//
//  The SwiftUI shader behind `.liquidMetal(...)` (see LiquidMetal.swift). The look is in LiquidMetalCore.h.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
#include "LiquidMetalCore.h"
using namespace metal;

/// Applied as a colour effect: `color` is what the shape drew, and only its alpha (the shape's coverage) is used.
[[ stitchable ]] half4 liquidMetal(float2 position, half4 color, float2 size, float time, float strength, float hover, float mode, half4 tint) {
    float3 rgb = liquidMetalRGB(position, size, time, float3(tint.rgb), hover, mode);
    float a = float(color.a) * clamp(strength, 0.0, 1.0);
    return half4(half3(rgb * a), half(a));
}
