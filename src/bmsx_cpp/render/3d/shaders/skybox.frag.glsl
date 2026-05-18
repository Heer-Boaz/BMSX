precision mediump float;

uniform sampler2D u_slot_primary;
uniform sampler2D u_slot_secondary;
// GLES2 parity note: TS WebGL2 uses uniform arrays indexed by skybox face.
// The SNES-mini GLES2 floor has stricter shader-indexing behavior, so this
// backend keeps the same six face records but exposes them as scalar uniforms.
uniform vec4 u_face_uv_rect0;
uniform vec4 u_face_uv_rect1;
uniform vec4 u_face_uv_rect2;
uniform vec4 u_face_uv_rect3;
uniform vec4 u_face_uv_rect4;
uniform vec4 u_face_uv_rect5;
uniform float u_face_slot0;
uniform float u_face_slot1;
uniform float u_face_slot2;
uniform float u_face_slot3;
uniform float u_face_slot4;
uniform float u_face_slot5;
uniform vec3 u_skyTint;
uniform float u_skyExposure;

varying vec3 v_texcoord;

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

vec4 face_uv_rect(int faceIndex) {
	if (faceIndex == 0) return u_face_uv_rect0;
	if (faceIndex == 1) return u_face_uv_rect1;
	if (faceIndex == 2) return u_face_uv_rect2;
	if (faceIndex == 3) return u_face_uv_rect3;
	if (faceIndex == 4) return u_face_uv_rect4;
	return u_face_uv_rect5;
}

float face_slot(int faceIndex) {
	if (faceIndex == 0) return u_face_slot0;
	if (faceIndex == 1) return u_face_slot1;
	if (faceIndex == 2) return u_face_slot2;
	if (faceIndex == 3) return u_face_slot3;
	if (faceIndex == 4) return u_face_slot4;
	return u_face_slot5;
}

void main() {
	vec2 faceUv;
	int faceIndex = resolve_skybox_face(v_texcoord, faceUv);
	vec4 rect = face_uv_rect(faceIndex);
	vec2 slotUv = rect.xy + faceUv * rect.zw;
	vec3 texColor = face_slot(faceIndex) < 0.5
		? texture2D(u_slot_primary, slotUv).rgb
		: texture2D(u_slot_secondary, slotUv).rgb;
	texColor *= u_skyTint * u_skyExposure;
	gl_FragColor = vec4(texColor, 1.0);
}
