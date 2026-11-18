// Music Wall scenes for Windows (issue #119), the same scene code as the Mac's VoxelWall.metal, as WebGL 2. Draws one scene into a
// canvas every frame from a state function: { scene 0-3, palette [a, b] (0-1 RGB), bands [4], intensity, speed }.
// Scenes: 0 Block Field, 1 Spike Field, 2 Infinite Tunnel, 3 Block City. Drawn at 3/4 resolution to keep the GPU cool.

const FUNCS = `float vwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vwNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = vwHash(i), b = vwHash(i + vec2(1, 0)), c = vwHash(i + vec2(0, 1)), d = vwHash(i + vec2(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/// Height of the column in cell c (world units; one cube is 0.5 tall).
float vwHeight(vec2 c, float t, vec4 bands, float scene, float intensity) {
    float n = vwNoise(c * 0.085 + vec2(t * 0.11, t * 0.05));
    float n2 = vwNoise(c * 0.23 - vec2(t * 0.2, 0.0));
    float wave = 0.5 + 0.5 * sin(c.x * 0.32 + c.y * 0.12 + t * 1.6);
    float swell = 0.5 + 0.5 * sin(length(c - vec2(0.0, t * 2.2 + 30.0)) * 0.22 - t * 3.0);
    float h;
    if (scene > 2.5) {                                                   // Block City: blocks of buildings
        vec2 block = floor(c / 3.0);
        float b = vwHash(block);
        float street = (mod(abs(c.x), 3.0) < 1.0 || mod(abs(c.y), 3.0) < 1.0) ? 0.0 : 1.0;
        h = street * (0.6 + pow(b, 2.0) * 6.0 * (0.75 + 0.5 * bands.x * intensity));
    } else if (scene > 0.5) {                                            // Spike Field
        float spike = pow(vwHash(c + floor(t * 3.0)), 14.0) * (2.5 + 7.0 * bands.x * intensity);
        h = 0.25 + n * n * 1.6 + spike + bands.y * intensity * wave * 1.2;
    } else {                                                             // Block Field
        float n3 = vwNoise(c * 0.04 + vec2(-t * 0.06, t * 0.04));
        h = 0.3 + n3 * 3.0 + n * n * 2.2 + intensity * (bands.x * 3.4 * swell * (0.4 + n3) + bands.y * 1.4 * wave + bands.z * 0.8 * n2);
    }
    return floor(h * 2.0) * 0.5 + 0.5;                                   // stacked half-unit cubes
}

vec3 vwPalette(float x, vec3 a, vec3 b) {
    x = clamp(x, 0.0, 1.0);
    return mix(a * 0.35, mix(a, b, smoothstep(0.35, 1.0, x)), smoothstep(0.0, 0.5, x));
}

/// The field scenes (0, 1, 3): a ray-walk across the grid until the ray meets a column.
vec3 vwField(vec2 uv, float t, vec4 bands, float scene, float intensity, vec3 colA, vec3 colB) {
    bool city = scene > 2.5;
    vec3 ro = vec3(sin(t * 0.07) * 9.0, city ? 13.0 : 17.0, t * (city ? 2.2 : 3.4));
    vec3 fwd = normalize(vec3(sin(t * 0.05) * 0.25, city ? -0.45 : -0.62, 1.0));
    vec3 right = normalize(cross(vec3(0, 1, 0), fwd));
    vec3 up = cross(fwd, right);
    float fov = city ? 0.95 : 1.35;
    vec3 rd = normalize(fwd + uv.x * right * fov + uv.y * up * fov);
    vec3 sky = mix(colA * 0.08, colB * 0.12, smoothstep(-0.3, 0.6, uv.y)) + 0.015;
    if (rd.y > -0.01) return sky;

    vec2 cell = floor(ro.xz);
    vec2 stepv = sign(rd.xz);
    vec2 tDelta = abs(1.0 / rd.xz);
    vec2 tMax = ((cell + max(stepv, 0.0)) - ro.xz) / rd.xz;
    float tPrev = 0.0;
    int axis = 0;
    for (int i = 0; i < 160; i++) {
        float h = vwHeight(cell, t, bands, scene, intensity);
        float tNext = min(tMax.x, tMax.y);
        float yEnter = ro.y + rd.y * tPrev, yExit = ro.y + rd.y * tNext;
        if (yExit <= h) {
            bool side = yEnter <= h && i > 0;
            float th = side ? tPrev : (h - ro.y) / rd.y;
            vec3 p = ro + rd * th;
            float k = h / (city ? 6.0 : 6.5);
            vec3 base = vwPalette(k, colA, colB);
            vec3 col;
            if (side) {
                float seam = smoothstep(0.0, 0.06, fract(p.y * 2.0)) * smoothstep(0.0, 0.06, 1.0 - fract(p.y * 2.0));
                float edge = axis == 0 ? fract(p.z) : fract(p.x);
                float vline = smoothstep(0.0, 0.05, edge) * smoothstep(0.0, 0.05, 1.0 - edge);
                col = base * (axis == 0 ? 0.42 : 0.62) * (0.55 + 0.45 * seam * vline);
                if (city && vwHash(vec2(floor((axis == 0 ? p.z : p.x) * 2.0), floor(p.y * 2.0)) + cell * 7.0) > 0.82 - bands.w * 0.3) col += colB * 0.5;   // lit windows
            } else {
                vec2 f = fract(p.xz);
                float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
                col = base * (0.85 + 0.35 * k) * (0.6 + 0.4 * smoothstep(0.0, 0.07, edge));
                float sparkle = step(0.9, vwHash(cell + floor(t * 6.0))) * smoothstep(0.55, 0.9, k) * bands.w * intensity;
                col += vec3(1.0) * sparkle * 1.4;
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
vec3 vwTunnel(vec2 uv, float t, vec4 bands, float intensity, vec3 colA, vec3 colB) {
    float speed = t * (3.0 + bands.x * intensity * 2.0);
    float r = max(abs(uv.x), abs(uv.y));                                 // square tunnel
    float z = 0.45 / max(r, 0.02) + speed;
    float side = abs(uv.x) > abs(uv.y) ? (uv.x > 0.0 ? 0.0 : 1.0) : (uv.y > 0.0 ? 2.0 : 3.0);
    float along = (abs(uv.x) > abs(uv.y) ? uv.y / abs(uv.x) : uv.x / abs(uv.y)) * 6.0;
    vec2 cell = vec2(floor(along), floor(z * 2.0));
    float bump = vwHash(cell + side * 31.0);
    float pulse = bands.y * intensity * (0.5 + 0.5 * sin(cell.y * 0.7 + t * 4.0));
    float lit = smoothstep(0.55 - pulse * 0.4, 1.0, bump);
    vec2 f = vec2(fract(along), fract(z * 2.0));
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    vec3 col = vwPalette(0.25 + bump * 0.75 * (0.6 + pulse), colA, colB) * (0.35 + 0.65 * smoothstep(0.0, 0.08, edge));
    col += colB * lit * (0.25 + bands.w * intensity * 0.8);
    float depthFade = smoothstep(0.0, 0.45, r);
    return col * depthFade + colA * 0.25 * (1.0 - depthFade) * (0.5 + bands.x);
}

`;

const FS = `#version 300 es
precision highp float; out vec4 o; uniform float T,S; uniform vec4 B; uniform vec3 A,C; uniform vec2 R;
${FUNCS}
void main(){vec2 size=R;vec2 position=vec2(gl_FragCoord.x,R.y-gl_FragCoord.y);
vec2 uv=(position-size*0.5)/size.y;uv.y=-uv.y;
vec3 rgb=(S>1.5&&S<2.5)?vwTunnel(uv,T,B,1.0,A,C):vwField(uv,T,B,S,1.0,A,C);
float vig=smoothstep(1.25,0.35,length(uv*vec2(0.85,1.1)));rgb*=0.55+0.45*vig;o=vec4(clamp(rgb,0.,1.),1.);}`;
const VS = `#version 300 es
in vec2 p;void main(){gl_Position=vec4(p,0,1);}`;

/** Starts drawing into `canvas`; returns a stop function, or null when this PC has no WebGL 2. */
export function startScene(canvas, state, { resolution = 0.75 } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) return null;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(pr, n);
  let raf = 0, alive = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(ms) {
    if (!alive) return;
    const s = state(ms / 1000);
    const w = Math.max(2, Math.round(canvas.clientWidth * resolution)), h = Math.max(2, Math.round(canvas.clientHeight * resolution));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform1f(U('T'), reduce ? 37.5 : ((ms / 1000) % 3600) * s.speed); gl.uniform1f(U('S'), s.scene); gl.uniform2f(U('R'), w, h);
    gl.uniform4f(U('B'), ...s.bands.map((x) => x * s.intensity)); gl.uniform3f(U('A'), ...s.palette[0]); gl.uniform3f(U('C'), ...s.palette[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!reduce) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { alive = false; cancelAnimationFrame(raf); };
}
