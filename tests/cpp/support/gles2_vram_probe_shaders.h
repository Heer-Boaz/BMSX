#pragma once

namespace bmsx::test::vram_probe {

inline constexpr const char* vertex = R"(
attribute vec2 a_position;
uniform vec4 u_region;
varying mediump vec2 v_uv;
void main() {
	gl_Position = vec4(a_position, 0.0, 1.0);
	v_uv = u_region.xy + (a_position * 0.5 + 0.5) * u_region.zw;
}
)";

// This is the experiment's representation boundary. The production nibble
// codec is included separately; no alternative format enters the actual core.
inline constexpr const char* representation = R"(
uniform sampler2D u_source;
uniform sampler2D u_destination;
uniform vec2 u_sourceScale;
varying mediump vec2 v_uv;
ivec2 probeWord(vec4 pixel) {
#if PROBE_FORMAT == 0
	return gxWordBytes(pixel);
#else
#if PROBE_FORMAT == 3
	ivec3 c = ivec3(pixel.rgb * 255.0 + 0.5) / 8;
#else
	ivec3 c = ivec3(pixel.rgb * 31.0 + 0.5);
#endif
	return ivec2(c.r + (c.g - (c.g / 8) * 8) * 32,
		c.g / 8 + c.b * 4 + (pixel.a >= 0.5 ? 128 : 0));
#endif
}
vec4 probeStore(ivec3 color, int mask) {
#if PROBE_FORMAT == 0
	return encodeRgb555(color, mask);
#elif PROBE_FORMAT == 3
	return vec4(vec3(color) * (8.0 / 255.0), float(mask));
#else
	return vec4(vec3(color) / 31.0, float(mask));
#endif
}
vec4 probeStoreWord(ivec2 word) {
	return probeStore(decodeRgb555To5(word), word.y / 128);
}
)";

inline constexpr const char* upload = R"(
void main() {
	ivec2 word = ivec2(texture2D(u_source, gl_FragCoord.xy / 256.0).ra * 255.0 + 0.5);
	gl_FragColor = probeStoreWord(word);
}
)";

inline constexpr const char* read = R"(
void main() {
	ivec2 word = probeWord(texture2D(u_source, v_uv));
	gl_FragColor = encodeRgb555(decodeRgb555To5(word), word.y / 128);
}
)";

inline constexpr const char* copy = R"(
void main() { gl_FragColor = texture2D(u_source, v_uv); }
)";

inline constexpr const char* clut = R"(
uniform int u_depth;
uniform int u_shift;
void main() {
	ivec2 word = probeWord(texture2D(u_source, v_uv));
	int index;
	if (u_depth == 4) {
		int byte = u_shift < 2 ? word.x : word.y;
		if (u_shift - (u_shift / 2) * 2 != 0) byte /= 16;
		index = byte - (byte / 16) * 16;
	} else {
		index = u_shift == 0 ? word.x : word.y;
	}
	gl_FragColor = probeStoreWord(probeWord(texture2D(u_destination, vec2((float(index) + 0.5) / 256.0, 0.5))));
}
)";

inline constexpr const char* exact = R"(
uniform int u_mode;
uniform int u_kind;
uniform int u_checkMask;
uniform int u_forceMask;
ivec3 blendColor(ivec3 f, ivec3 b) {
	if (u_mode == 0) return (f + b) / 2;
	if (u_mode == 1) return ivec3(clamp(vec3(f + b), 0.0, 31.0));
	if (u_mode == 2) return ivec3(clamp(vec3(b - f), 0.0, 31.0));
	return ivec3(clamp(vec3(b + f / 4), 0.0, 31.0));
}
void main() {
	ivec2 source = probeWord(texture2D(u_source, v_uv * u_sourceScale));
	if (u_kind == 1 && all(equal(source, ivec2(0)))) discard;
	ivec2 destination = probeWord(texture2D(u_destination, v_uv));
	if (u_checkMask != 0 && destination.y >= 128) discard;
	ivec3 color = decodeRgb555To5(source);
	if (u_kind >= 0 && (u_kind == 0 || source.y >= 128))
		color = blendColor(color, decodeRgb555To5(destination));
	int mask = u_forceMask != 0 ? 1 : (u_kind == 0 ? 0 : source.y / 128);
	gl_FragColor = probeStore(color, mask);
}
)";

inline constexpr const char* hardware = R"(
uniform int u_mode;
uniform int u_kind;
uniform int u_forceMask;
uniform int u_class;
uniform int u_bias;
void main() {
	ivec2 source = probeWord(texture2D(u_source, v_uv * u_sourceScale));
	int mask = source.y / 128;
	if (u_kind == 1 && (all(equal(source, ivec2(0))) || mask != u_class)) discard;
	vec3 color = vec3(decodeRgb555To5(source));
	// Bias is applied only to fragments which actually blend. Opaque texels
	// in a semi-transparent primitive must retain their original source color.
	if (u_kind == 0 || u_class == 1) {
		if (u_bias == 1 && u_mode == 0) color -= 0.5;
		if (u_bias == 1 && u_mode == 3) color -= 1.5;
		if (u_bias == 2 && u_mode == 3) color = vec3(ivec3(color) / 4);
	}
#if PROBE_FORMAT == 3
	color *= (8.0 / 255.0);
#else
	color /= 31.0;
#endif
	gl_FragColor = vec4(color, u_forceMask != 0 ? 1.0 : (u_kind == 0 ? 0.0 : float(mask)));
}
)";

} // namespace bmsx::test::vram_probe
