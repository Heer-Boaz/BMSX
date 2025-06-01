#version 300 es
precision highp float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
// uniform sampler2D u_texture2;
// uniform sampler2D u_texture3;
// uniform sampler2D u_texture4;
// uniform sampler2D u_texture5;
// uniform sampler2D u_texture6;
// uniform sampler2D u_texture7;

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
        // case 2u: // Use the third texture if atlas ID is 2
        //     texColor = texture(u_texture2, v_texcoord);
        //     break;
        // case 3u: // Use the fourth texture if atlas ID is 3
        //     texColor = texture(u_texture3, v_texcoord);
        //     break;
        // case 4u: // Use the fifth texture if atlas ID is 4
        //     texColor = texture(u_texture4, v_texcoord);
        //     break;
        // case 5u: // Use the sixth texture if atlas ID is 5
        //     texColor = texture(u_texture5, v_texcoord);
        //     break;
        // case 6u: // Use the seventh texture if atlas ID is 6
        //     texColor = texture(u_texture6, v_texcoord);
        //     break;
        // case 7u: // Use the eighth texture if atlas ID is 7
        //     texColor = texture(u_texture7, v_texcoord);
        //     break;
        default: // Default to the first texture for any other atlas ID
            texColor = texture(u_texture0, v_texcoord);
            break;
    }
    texColor *= v_color_override;

    outputColor = texColor;
}
