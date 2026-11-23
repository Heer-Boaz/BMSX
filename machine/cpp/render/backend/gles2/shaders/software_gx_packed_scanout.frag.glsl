precision mediump float;
precision mediump int;
varying mediump vec2 v_uv;
uniform sampler2D u_source;

#include "gx_gpu_words.glsl"

void main() {
	gl_FragColor = vec4(rgb555Pixel(gxWordBytes(texture2D(u_source, v_uv)))) / 255.0;
}
