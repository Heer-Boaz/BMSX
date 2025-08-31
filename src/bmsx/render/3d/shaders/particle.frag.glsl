#version 300 es
precision mediump float;

in vec4 v_color;
in vec2 v_texcoord;
uniform sampler2D u_texture;
out vec4 outColor;
// Frame-shared UBO with ambient
layout(std140) uniform FrameUniforms {
    vec2 u_offscreenSize;
    vec2 u_logicalSize;
    vec4 u_timeDelta;
    mat4 u_view;
    mat4 u_proj;
    vec4 u_cameraPos_frame;
    vec4 u_ambient_frame;   // rgb,intensity
};
uniform int u_particleAmbientMode;   // 0=unlit, 1=ambient
uniform float u_particleAmbientFactor; // 0..1 strength if ambient

void main() {
    vec4 tex = texture(u_texture, v_texcoord);
    vec4 c = tex * v_color;
    if (u_particleAmbientMode == 1) {
        float f = clamp(u_particleAmbientFactor, 0.0, 1.0);
        c.rgb *= mix(vec3(1.0), u_ambient_frame.rgb * u_ambient_frame.a, f);
    }
    outColor = c;
}
