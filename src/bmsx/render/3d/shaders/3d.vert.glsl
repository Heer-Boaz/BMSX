#version 300 es
precision mediump float;

in vec3 a_position; // Vertex position in 3D space
in vec2 a_texcoord; // Texture coordinates for the vertex
in vec3 a_normal; // Normal vector for lighting calculations
in vec4 a_color_override; // Color override for the vertex
in uint a_atlas_id; // Atlas ID for texture mapping

uniform mat4 u_mvp; // Model-View-Projection matrix for transforming the vertex position
uniform mat4 u_model; // Model matrix for transforming the vertex position
uniform mat3 u_normalMatrix; // Normal matrix for transforming normals
uniform float u_scale; // Scaling factor for the position

out vec2 v_texcoord; // Texture coordinates to pass to the fragment shader
out vec4 v_color_override; // Color override to pass to the fragment shader
flat out uint v_atlas_id; // Atlas ID to pass to the fragment shader
out vec3 v_normal; // Normal vector to pass to the fragment shader
out vec3 v_worldPos; // World position of the vertex to pass to the fragment shader

void main() {
    vec3 scaledPosition = a_position * u_scale; // Scale position before transformation
    vec4 world = u_model * vec4(scaledPosition, 1.0); // Transform position to world space
    gl_Position = u_mvp * vec4(scaledPosition, 1.0); // Transform position to clip space
    v_worldPos = world.xyz; // Pass the world position to the fragment shader
    v_texcoord = a_texcoord; // Pass the texture coordinates to the fragment shader
    v_color_override = a_color_override; // Pass the color override to the fragment shader
    v_atlas_id = a_atlas_id; // Pass the atlas ID to the fragment shader
    v_normal = u_normalMatrix * a_normal; // Pass the normal vector to the fragment shader
}