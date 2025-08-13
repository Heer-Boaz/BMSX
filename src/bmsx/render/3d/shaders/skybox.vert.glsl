#version 300 es
precision mediump float;

in vec3 a_position;

uniform mat4 u_view;
uniform mat4 u_projection;

out vec3 v_texcoord;

void main() {
    // Rotate the lookup direction by the camera's view matrix
    // (w = 0 so translation is ignored even if present)
    v_texcoord = (u_view * vec4(a_position, 0.0)).xyz;

    // Position the cube at the camera without applying the view rotation
    vec4 pos = u_projection * vec4(a_position, 1.0);
    gl_Position = pos.xyww; // Ensure far plane with correct w
}