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
