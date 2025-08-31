#version 300 es
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_atlas_id;

out vec4 outputColor;
// Frame-shared UBO with ambient
layout(std140) uniform FrameUniforms {
    vec2 u_offscreenSize;
    vec2 u_logicalSize;
    vec4 u_timeDelta; // x=time, y=delta
    mat4 u_view;
    mat4 u_proj;
    vec4 u_cameraPos; // xyz, pad
    vec4 u_ambient_frame; // rgb,intensity
};
uniform int u_spriteAmbientEnabled;  // 0/1
uniform float u_spriteAmbientFactor; // 0..1

void main() {
    vec4 texColor;
    switch (v_atlas_id) {
        case 0u: // Use the first texture if atlas ID is 0
            texColor = texture(u_texture0, v_texcoord);
            break;
        case 1u: // Use the second texture if atlas ID is 1
            texColor = texture(u_texture1, v_texcoord);
            break;
        default: // Default to the dynamic atlas for any other atlas ID
            texColor = texture(u_texture1, v_texcoord);
            break;
    }
    texColor *= v_color_override;
    if (u_spriteAmbientEnabled == 1) {
        float f = clamp(u_spriteAmbientFactor, 0.0, 1.0);
        texColor.rgb *= mix(vec3(1.0), u_ambient_frame.rgb * u_ambient_frame.a, f);
    }
    outputColor = texColor;
}
