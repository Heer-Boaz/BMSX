#version 300 es
precision mediump float;

in vec3 a_position; // line endpoints in world-axis space: (0,0,0)->(+X/+Y/+Z)
in vec3 a_color;

uniform mat4 u_view;      // full view matrix; we use rotation only (w=0)
uniform float u_aspect;   // width/height
uniform float u_size;     // axis length in NDC units (0..1)
uniform vec2 u_offset;    // NDC position of origin (e.g., (-0.85, -0.85))

out vec3 v_color;

void main() {
	// Map world-axis direction into view space; ignore translation via w=0
	vec3 v = (u_view * vec4(a_position, 0.0)).xyz;
	// Keep proportions under aspect (scale X by 1/aspect)
	vec2 p = vec2(v.x / max(1e-6, u_aspect), v.y);
	gl_Position = vec4(u_offset + p * u_size, 0.0, 1.0);
	v_color = a_color;
}

