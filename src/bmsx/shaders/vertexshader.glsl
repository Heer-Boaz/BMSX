#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texcoord;
in vec4 a_color_override;
in float a_pos_z;

uniform vec2 u_resolution;
uniform float u_scale;

out vec2 v_texcoord;
out vec4 v_color_override;

void main() {
    // Scale the position by the scaling factor
    vec2 scaledPosition = a_position * u_scale;

    // Convert the rectangle from pixels to clipspace coordinates and invert Y-axis
    vec2 clipSpace = ((scaledPosition / u_resolution) * 2.0 - 1.0) * vec2(1, -1); // Flip Y-axis to match WebGL coordinates (0,0 is bottom-left) and convert to clipspace coordinates (-1 to 1)

    gl_Position = vec4(clipSpace, a_pos_z, 1); // Set the vertex position (z is used for depth sorting) and w to 1.0 (required for clipping)

    // Pass the texCoord and color_override to the fragment shader
    v_texcoord = a_texcoord;
    v_color_override = a_color_override;
}
