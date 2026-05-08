precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
// GLES2 parity note: TS WebGL2 receives ambient through the FrameUniforms UBO.
// Strict GLES2 has no UBO, so the C++ pass uploads the same resolved frame
// ambient as this pass uniform.
uniform vec4 u_ambient_color_intensity;

varying vec2 v_texcoord;
varying vec4 v_color;
varying float v_textpage_id;
// GLES2 parity note: TS uses batch uniforms for particle ambient mode/factor.
// The old-GLES2 C++ path expands all particles into one stream, so these values
// ride with each expanded vertex instead of requiring extension instancing.
varying float v_ambient_mode;
varying float v_ambient_factor;

void main() {
	vec4 texColor;
	if (v_textpage_id < 0.5) {
		texColor = texture2D(u_texture0, v_texcoord);
	} else if (v_textpage_id < 1.5) {
		texColor = texture2D(u_texture1, v_texcoord);
	} else {
		texColor = texture2D(u_texture2, v_texcoord);
	}
	vec4 c = texColor * v_color;
	if (v_ambient_mode > 0.5) {
		c.rgb *= mix(vec3(1.0), u_ambient_color_intensity.rgb * u_ambient_color_intensity.a, v_ambient_factor);
	}
	gl_FragColor = c;
}
