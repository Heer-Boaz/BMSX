precision highp float;
// C1 layout (68 words = 17 vec4s):
//   u_c1[0]      = ambient.rgb + intensity
//   u_c1[1..2]   = dir light 0: dir.xyz+pad, color.rgb+intensity
//   u_c1[3..4]   = dir light 1: dir.xyz+pad, color.rgb+intensity
//   u_c1[5..6]   = dir light 2: dir.xyz+pad, color.rgb+intensity
//   u_c1[7..8]   = dir light 3: dir.xyz+pad, color.rgb+intensity
//   u_c1[9..10]  = point light 0: pos.xyz+range, color.rgb+intensity
//   u_c1[11..12] = point light 1: pos.xyz+range, color.rgb+intensity
//   u_c1[13..14] = point light 2: pos.xyz+range, color.rgb+intensity
//   u_c1[15..16] = point light 3: pos.xyz+range, color.rgb+intensity
uniform sampler2D u_t0;
uniform sampler2D u_t1;
uniform int u_textureEnabled;
uniform int u_textureFlipY;
uniform int u_t1Mode;
uniform int u_lightingMode;
uniform vec4 u_c1[17];
varying vec2 v_uv0;
varying vec4 v_color;
varying vec3 v_normal;
varying vec3 v_pos;
void main() {
	gl_FragColor = v_color;
	if (u_textureEnabled != 0) {
		vec2 sampleUv = u_textureFlipY != 0 ? vec2(v_uv0.x, 1.0 - v_uv0.y) : v_uv0;
		gl_FragColor *= texture2D(u_t0, sampleUv);
	}
	if (u_t1Mode != 0) {
		vec2 sampleUv = u_textureFlipY != 0 ? vec2(v_uv0.x, 1.0 - v_uv0.y) : v_uv0;
		gl_FragColor *= texture2D(u_t1, sampleUv);
	}
	if (u_lightingMode != 0) {
		vec3 n = normalize(v_normal);
		vec4 ambientWord = u_c1[0];
		vec3 lit = ambientWord.rgb * ambientWord.a;
		for (int i = 0; i < 4; i++) {
			vec4 dirWord = u_c1[1 + i * 2];
			vec4 colWord = u_c1[2 + i * 2];
			if (colWord.a > 0.0) {
				float ndl = max(dot(n, normalize(dirWord.xyz)), 0.0);
				lit += colWord.rgb * (colWord.a * ndl);
			}
		}
		for (int i = 0; i < 4; i++) {
			vec4 ptWord = u_c1[9 + i * 2];
			vec4 ptCol = u_c1[10 + i * 2];
			float range = ptWord.w;
			if (range > 0.0 && ptCol.a > 0.0) {
				vec3 toLight = ptWord.xyz - v_pos;
				float d = length(toLight);
				if (d < range) {
					float atten = 1.0 - d / range;
					float ndl = max(dot(n, toLight / d), 0.0);
					lit += ptCol.rgb * (ptCol.a * ndl * atten);
				}
			}
		}
		gl_FragColor.rgb *= lit;
	}
	if (gl_FragColor.a <= 0.0) {
		discard;
	}
}
