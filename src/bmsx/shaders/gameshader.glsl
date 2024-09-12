#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_texcoord;
in vec4 v_color_override;
out vec4 outputColor;

void main() {
    vec4 texColor = texture(u_texture, v_texcoord) * v_color_override; // Sample the texture and multiply by the color_override

    outputColor = texColor;
}
