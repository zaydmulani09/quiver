/**
 * GLSL sources for the magnification pipeline. Everything works in YIQ so that
 * luminance and chrominance can be amplified independently (as in the original
 * Eulerian Video Magnification paper, Wu et al. SIGGRAPH 2012).
 */

export const VERT = `#version 300 es
out vec2 v_uv;
void main() {
  // Full-screen triangle from gl_VertexID; no buffers needed.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COLOR_SPACE = `
vec3 rgb2yiq(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.596, -0.274, -0.322)),
    dot(c, vec3(0.211, -0.523, 0.312)));
}
vec3 yiq2rgb(vec3 c) {
  return vec3(
    c.x + 0.956 * c.y + 0.621 * c.z,
    c.x - 0.272 * c.y - 0.647 * c.z,
    c.x - 1.106 * c.y + 1.703 * c.z);
}`;

/** Video → YIQ at processing resolution. Video textures arrive top-row-first, hence the flip. */
export const FRAG_TO_YIQ = `#version 300 es
precision highp float;
uniform sampler2D u_src;
in vec2 v_uv;
out vec4 o;
${COLOR_SPACE}
void main() {
  vec3 c = texture(u_src, vec2(v_uv.x, 1.0 - v_uv.y)).rgb;
  o = vec4(rgb2yiq(c), 1.0);
}`;

/** Gaussian-ish 2× downsample (dual-filter kernel: centre ×4 plus four diagonal taps). */
export const FRAG_DOWN = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_texel; // 1 / source size
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 4.0;
  c += texture(u_src, v_uv + vec2(-u_texel.x, -u_texel.y)).rgb;
  c += texture(u_src, v_uv + vec2( u_texel.x, -u_texel.y)).rgb;
  c += texture(u_src, v_uv + vec2(-u_texel.x,  u_texel.y)).rgb;
  c += texture(u_src, v_uv + vec2( u_texel.x,  u_texel.y)).rgb;
  o = vec4(c / 8.0, 1.0);
}`;

/** Laplacian band: fine level minus bilinearly upsampled coarser level. */
export const FRAG_LAPLACIAN = `#version 300 es
precision highp float;
uniform sampler2D u_fine;
uniform sampler2D u_coarse;
in vec2 v_uv;
out vec4 o;
void main() {
  o = vec4(texture(u_fine, v_uv).rgb - texture(u_coarse, v_uv).rgb, 1.0);
}`;

/**
 * Temporal IIR step. Two first-order low-pass filters run side by side (MRT);
 * their difference is a band-pass. r = 1 - exp(-2π f_c dt).
 */
export const FRAG_IIR = `#version 300 es
precision highp float;
uniform sampler2D u_x;
uniform sampler2D u_lo1;
uniform sampler2D u_lo2;
uniform float u_r1;
uniform float u_r2;
uniform float u_reset;
in vec2 v_uv;
layout(location = 0) out vec4 o1;
layout(location = 1) out vec4 o2;
void main() {
  vec3 x = texture(u_x, v_uv).rgb;
  if (u_reset > 0.5) { o1 = vec4(x, 1.0); o2 = vec4(x, 1.0); return; }
  vec3 a = texture(u_lo1, v_uv).rgb;
  vec3 b = texture(u_lo2, v_uv).rgb;
  o1 = vec4(mix(a, x, u_r1), 1.0);
  o2 = vec4(mix(b, x, u_r2), 1.0);
}`;

/** Motion mode collapse: D_i = up(D_{i+1}) + gain_i · (lo1_i − lo2_i). */
export const FRAG_COLLAPSE = `#version 300 es
precision highp float;
uniform sampler2D u_coarse;
uniform sampler2D u_lo1;
uniform sampler2D u_lo2;
uniform vec3 u_gain;
uniform float u_hasCoarse;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 base = u_hasCoarse > 0.5 ? texture(u_coarse, v_uv).rgb : vec3(0.0);
  vec3 band = texture(u_lo1, v_uv).rgb - texture(u_lo2, v_uv).rgb;
  o = vec4(base + band * u_gain, 1.0);
}`;

/** Colour mode: bicubic-upsample the low-resolution band and scale it. */
export const FRAG_COLOR_BAND = `#version 300 es
precision highp float;
uniform sampler2D u_lo1;
uniform sampler2D u_lo2;
uniform vec2 u_size; // band texture size
uniform vec3 u_gain;
in vec2 v_uv;
out vec4 o;

vec4 cubic(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}
vec3 bicubic(sampler2D tex, vec2 uv) {
  vec2 texel = 1.0 / u_size;
  vec2 coords = uv * u_size - 0.5;
  vec2 fxy = fract(coords);
  coords -= fxy;
  vec4 xc = cubic(fxy.x);
  vec4 yc = cubic(fxy.y);
  vec4 c = coords.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = c + vec4(xc.yw, yc.yw) / s;
  off *= texel.xxyy;
  vec3 s0 = texture(tex, off.xz).rgb;
  vec3 s1 = texture(tex, off.yz).rgb;
  vec3 s2 = texture(tex, off.xw).rgb;
  vec3 s3 = texture(tex, off.yw).rgb;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
void main() {
  vec3 band = bicubic(u_lo1, v_uv) - bicubic(u_lo2, v_uv);
  o = vec4(band * u_gain, 1.0);
}`;

/** Motion energy probe: |diff luma| packed into 8 bits so it can be read back anywhere. */
export const FRAG_ENERGY = `#version 300 es
precision highp float;
uniform sampler2D u_diff;
uniform float u_scale;
in vec2 v_uv;
out vec4 o;
void main() {
  float e = abs(texture(u_diff, v_uv).x) * u_scale;
  o = vec4(clamp(e, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

/**
 * Final composite onto the visible canvas. Adds the amplified band to the *full-resolution*
 * video (so sharpness is preserved even though processing ran at a lower resolution),
 * handles mirroring, letterboxing, the before/after split and the "signal" heat view.
 */
export const FRAG_DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D u_video;
uniform sampler2D u_diff;
uniform int u_view;        // 0 magnified, 1 compare, 2 signal, 3 original
uniform float u_split;     // compare position 0..1 (in canvas space)
uniform float u_flip;      // 1 = mirror horizontally
uniform vec2 u_scale;      // letterbox scale
uniform vec2 u_offset;     // letterbox offset
uniform float u_signalGain;
uniform vec2 u_canvas;     // canvas size in px
in vec2 v_uv;
out vec4 o;
${COLOR_SPACE}

vec3 heat(float v) {
  // Signed diverging map: cool blues for negative, warm oranges for positive, on near-black.
  float a = clamp(abs(v), 0.0, 1.0);
  vec3 warm = mix(vec3(0.55, 0.05, 0.02), vec3(1.0, 0.85, 0.35), a);
  vec3 cool = mix(vec3(0.02, 0.10, 0.45), vec3(0.45, 0.95, 1.0), a);
  return (v >= 0.0 ? warm : cool) * a;
}

void main() {
  vec2 uv = (v_uv - u_offset) / u_scale;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float cx = v_uv.x;
  if (u_flip > 0.5) uv.x = 1.0 - uv.x;
  vec3 rgb = texture(u_video, vec2(uv.x, 1.0 - uv.y)).rgb;
  vec3 diff = texture(u_diff, uv).rgb;
  vec3 mag = clamp(yiq2rgb(rgb2yiq(rgb) + diff), 0.0, 1.0);

  if (u_view == 3) { o = vec4(rgb, 1.0); return; }
  if (u_view == 2) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    vec3 base = vec3(lum) * 0.22;
    o = vec4(base + heat(diff.x * u_signalGain), 1.0);
    return;
  }
  if (u_view == 1) {
    float px = abs(cx - u_split) * u_canvas.x;
    if (px < 1.0) { o = vec4(1.0); return; }
    o = vec4(cx < u_split ? rgb : mag, 1.0);
    return;
  }
  o = vec4(mag, 1.0);
}`;
