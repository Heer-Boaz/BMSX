#version 300 es
precision highp float;

// Uniform for the texture to be sampled
uniform sampler2D u_texture;

// Input texture coordinates and color override from the vertex shader
in vec2 v_texcoord;
in vec4 v_color_override;

// Output color to the framebuffer
out vec4 outputColor;

void main() {
    // Sample the texture at the given texture coordinates and multiply by the color override
    vec4 texColor = texture(u_texture, v_texcoord) * v_color_override;

    // Set the final output color
    outputColor = texColor;
}