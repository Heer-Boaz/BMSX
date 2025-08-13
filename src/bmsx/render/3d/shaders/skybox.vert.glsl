#version 300 es
precision mediump float;

in vec3 a_position;

uniform mat4 u_view;
uniform mat4 u_projection;

out vec3 v_texcoord;

void main() {
    v_texcoord = a_position; // Unnormalized direction from cube center
    vec4 pos = u_projection * u_view * vec4(a_position, 1.0);
    gl_Position = pos.xyww; // Ensure far plane with correct w
}