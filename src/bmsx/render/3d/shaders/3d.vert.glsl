#version 300 es
precision mediump float;

in vec3 a_position; // Vertex position in 3D space
in vec2 a_texcoord; // Texture coordinates for the vertex
in vec3 a_normal; // Normal vector for lighting calculations
in vec4 a_tangent; // Tangent vector (xyz) and bitangent sign (w)
in vec4 a_color_override; // Color override for the vertex
in uint a_atlas_id; // Atlas ID for texture mapping
in vec3 a_morphPos0;
in vec3 a_morphPos1;
in vec3 a_morphNorm0;
in vec3 a_morphNorm1;
in vec3 a_morphTan0;
in vec3 a_morphTan1;
in uvec4 a_joints;
in vec4 a_weights;

uniform mat4 u_mvp; // Model-View-Projection matrix for transforming the vertex position
uniform mat4 u_model; // Model matrix for transforming the vertex position
uniform mat3 u_normalMatrix; // Normal matrix for transforming normals
uniform float u_scale; // Scaling factor for the position
uniform float u_morphWeights[2];
uniform mat4 u_jointMatrices[32];

out vec2 v_texcoord; // Texture coordinates to pass to the fragment shader
out vec4 v_color_override; // Color override to pass to the fragment shader
flat out uint v_atlas_id; // Atlas ID to pass to the fragment shader
out vec3 v_normal; // Normal vector to pass to the fragment shader
out vec3 v_tangent; // Tangent vector in world space
out vec3 v_bitangent; // Bitangent vector in world space
out vec3 v_worldPos; // World position of the vertex to pass to the fragment shader

void main() {
    vec3 pos = a_position;
    vec3 normal = a_normal;
    vec3 tangent = a_tangent.xyz;
    float tanSign = a_tangent.w;
    pos += a_morphPos0 * u_morphWeights[0];
    normal += a_morphNorm0 * u_morphWeights[0];
    tangent += a_morphTan0 * u_morphWeights[0];
    pos += a_morphPos1 * u_morphWeights[1];
    normal += a_morphNorm1 * u_morphWeights[1];
    tangent += a_morphTan1 * u_morphWeights[1];
    mat4 skin = a_weights.x * u_jointMatrices[int(a_joints.x)] +
                a_weights.y * u_jointMatrices[int(a_joints.y)] +
                a_weights.z * u_jointMatrices[int(a_joints.z)] +
                a_weights.w * u_jointMatrices[int(a_joints.w)];
    vec4 skinnedPos = skin * vec4(pos, 1.0);
    vec3 skinnedNormal = (skin * vec4(normal, 0.0)).xyz;
    vec3 skinnedTangent = (skin * vec4(tangent, 0.0)).xyz;
    skinnedNormal = normalize(skinnedNormal);
    skinnedTangent = normalize(skinnedTangent - skinnedNormal * dot(skinnedNormal, skinnedTangent));
    vec3 skinnedBitangent = cross(skinnedNormal, skinnedTangent) * tanSign;
    vec3 scaledPosition = skinnedPos.xyz * u_scale; // Scale position before transformation
    vec4 world = u_model * vec4(scaledPosition, 1.0); // Transform position to world space
    gl_Position = u_mvp * vec4(scaledPosition, 1.0); // u_mvp = projection * view * model (column-major)
    v_worldPos = world.xyz; // Pass the world position to the fragment shader
    v_texcoord = a_texcoord; // Pass the texture coordinates to the fragment shader
    v_color_override = a_color_override; // Pass the color override to the fragment shader
    v_atlas_id = a_atlas_id; // Pass the atlas ID to the fragment shader
    v_normal = u_normalMatrix * skinnedNormal; // Pass the normal vector to the fragment shader
    v_tangent = u_normalMatrix * skinnedTangent;
    v_bitangent = u_normalMatrix * skinnedBitangent;
}