precision mediump float;
precision mediump int;
#include "gx_gpu_words.glsl"
uniform sampler2D u_source;
varying mediump vec2 v_uv;
void main() {
	vec4 pixel = texture2D(u_source, v_uv);
#ifdef GX_GPU_CACHE_LOAD_RGB5
	ivec2 word = gxWordBytes(pixel);
	gl_FragColor = vec4(vec3(decodeRgb555To5(word)) / 31.0, float(word.y / 128));
#elif defined(GX_GPU_CACHE_STORE_RGB5)
	ivec2 word = gxRgb5WordBytes(pixel);
	gl_FragColor = encodeRgb555(decodeRgb555To5(word), word.y / 128);
#else
	gl_FragColor = pixel;
#endif
}
