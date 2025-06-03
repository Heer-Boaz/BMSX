#version 300 es
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_atlas_id;

out vec4 outputColor;

void main() {
    vec4 texColor;
    switch (v_atlas_id) {
        case 0u: // Use the first texture if atlas ID is 0
            texColor = texture(u_texture0, v_texcoord);
            break;
        case 1u: // Use the second texture if atlas ID is 1
            texColor = texture(u_texture1, v_texcoord);
            break;
        default: // Default to the first texture for any other atlas ID
            texColor = texture(u_texture0, v_texcoord);
            break;
    }
    texColor *= v_color_override;

    outputColor = texColor;
}
