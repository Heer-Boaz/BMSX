#version 300 es
precision mediump float;

// Input attributes from the vertex buffer
in vec2 a_position;         // Vertex position
in vec2 a_texcoord;         // Texture coordinates
in vec4 a_color_override;   // Color override
in float a_pos_z;           // Z position for depth sorting
in uint a_atlas_id;         // Atlas ID for texture mapping

// Uniforms for resolution and scaling factor
// Legacy uniform (kept for compatibility during migration)
uniform vec2 u_resolution;  // Logical resolution fallback
uniform float u_scale;      // Scaling factor for the position

// Frame-shared UBO (std140). Only first fields are used in this shader.
layout(std140) uniform FrameUniforms {
    vec2 u_offscreenSize;
    vec2 u_logicalSize;
    vec4 u_timeDelta; // x=time, y=delta, z,w unused
    mat4 u_view;
    mat4 u_proj;
    vec4 u_cameraPos; // xyz, w pad
    vec4 u_ambient_frame; // rgb,intensity (kept for block parity with FS)
};

// Output variables to pass to the fragment shader
out vec2 v_texcoord;        // Texture coordinates to pass to the fragment shader
out vec4 v_color_override;  // Color override to pass to the fragment shader
flat out uint v_atlas_id;   // Atlas ID to pass to the fragment shader

void main() {
	// Scale the position by the scaling factor
	vec2 scaledPosition = a_position * u_scale;

	// Prefer frame UBO logical size; fallback to legacy uniform if zero.
	vec2 logicalRes = u_logicalSize;
	if (logicalRes.x <= 0.0 || logicalRes.y <= 0.0) {
		logicalRes = u_resolution;
	}
	// Convert the rectangle from pixels to clipspace coordinates and invert Y-axis
	vec2 clipSpace = ((scaledPosition / logicalRes) * 2.0 - 1.0) * vec2(1.0, -1.0);
	// Flip Y-axis to match WebGL coordinates (0,0 is bottom-left) and convert to clipspace coordinates (-1 to 1)

	// Set the vertex position (z is used for depth sorting) and w to 1.0 (required for clipping)
	gl_Position = vec4(clipSpace, a_pos_z, 1);

	// Pass the texture coordinates and color override to the fragment shader
	v_texcoord = a_texcoord; // Texture coordinates for the fragment shader
	v_color_override = a_color_override; // Color override for the fragment shader
	v_atlas_id = a_atlas_id; // Atlas ID for texture mapping
}
