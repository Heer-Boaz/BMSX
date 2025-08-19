#version 300 es
precision mediump float;

layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_instancePosSize; // xyz = position, w = size
layout(location = 2) in vec4 a_color;

uniform mat4 u_viewProjection;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;

out vec4 v_color;
out vec2 v_texcoord;

void main() {
    vec3 worldPos = a_instancePosSize.xyz +
        (u_cameraRight * a_pos.x + u_cameraUp * a_pos.y) * a_instancePosSize.w;
    gl_Position = u_viewProjection * vec4(worldPos, 1.0);
    v_color = a_color;
    v_texcoord = a_pos + vec2(0.5);
}
