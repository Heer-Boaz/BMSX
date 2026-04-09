#version 300 es
precision mediump float;

in vec3 v_texcoord;
uniform sampler2D u_atlas_primary;
uniform sampler2D u_atlas_secondary;
uniform vec4 u_face_uv_rect[6];
uniform int u_face_atlas[6];
out vec4 outputColor;
uniform vec3 u_skyTint;
uniform float u_skyExposure;

int resolve_skybox_face(vec3 dir, out vec2 uv) {
	vec3 absDir = abs(dir);
	float ma;
	float sc;
	float tc;
	if (absDir.x >= absDir.y && absDir.x >= absDir.z) {
		ma = absDir.x;
		if (dir.x >= 0.0) {
			sc = -dir.z;
			tc = -dir.y;
			uv = vec2(sc, tc) / ma * 0.5 + 0.5;
			return 0;
		}
		sc = dir.z;
		tc = -dir.y;
		uv = vec2(sc, tc) / ma * 0.5 + 0.5;
		return 1;
	}
	if (absDir.y >= absDir.z) {
		ma = absDir.y;
		if (dir.y >= 0.0) {
			sc = dir.x;
			tc = dir.z;
			uv = vec2(sc, tc) / ma * 0.5 + 0.5;
			return 2;
		}
		sc = dir.x;
		tc = -dir.z;
		uv = vec2(sc, tc) / ma * 0.5 + 0.5;
		return 3;
	}
	ma = absDir.z;
	if (dir.z >= 0.0) {
		sc = dir.x;
		tc = -dir.y;
		uv = vec2(sc, tc) / ma * 0.5 + 0.5;
		return 4;
	}
	sc = -dir.x;
	tc = -dir.y;
	uv = vec2(sc, tc) / ma * 0.5 + 0.5;
	return 5;
}

void main() {
	vec2 faceUv;
	int faceIndex = resolve_skybox_face(v_texcoord, faceUv);
	vec4 rect = u_face_uv_rect[faceIndex];
	vec2 atlasUv = rect.xy + faceUv * rect.zw;
	vec3 texColor;
	if (u_face_atlas[faceIndex] == 0) {
		texColor = texture(u_atlas_primary, atlasUv).rgb;
	} else {
		texColor = texture(u_atlas_secondary, atlasUv).rgb;
	}
	texColor *= (u_skyTint * u_skyExposure);
	outputColor = vec4(texColor, 1.0f);
}
