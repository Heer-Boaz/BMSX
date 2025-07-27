#version 300 es
precision mediump float;

in vec3 a_position;
in vec2 a_texcoord;
in vec3 a_normal;
in vec4 a_color_override;
in uint a_atlas_id;

uniform mat4 u_mvp;
uniform mat4 u_model;
uniform mat3 u_normalMatrix;

out vec2 v_texcoord;
out vec4 v_color_override;
flat out uint v_atlas_id;
out vec3 v_normal;
out vec3 v_worldPos;

void main() {
    vec4 world = u_model * vec4(a_position, 1.0);
    gl_Position = u_mvp * vec4(a_position, 1.0);
    v_worldPos = world.xyz;
    v_texcoord = a_texcoord;
    v_color_override = a_color_override;
    v_atlas_id = a_atlas_id;
    v_normal = u_normalMatrix * a_normal;
}
