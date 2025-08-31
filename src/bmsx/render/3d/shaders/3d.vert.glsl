#version 300 es
precision mediump float;

in vec3 a_position; // Vertex position in 3D space
in vec2 a_texcoord; // Texture coordinates for the vertex
in vec3 a_normal; // Normal vector for lighting calculations
in vec4 a_tangent; // Tangent vector (xyz) and bitangent sign (w)
// Morph normals are sampled from texture
in uvec4 a_joints;
in vec4 a_weights;
layout(location=8) in vec4 a_i0;
layout(location=9) in vec4 a_i1;
layout(location=10) in vec4 a_i2;
layout(location=11) in vec4 a_i3;
layout(location=12) in vec4 a_iColor; // per-instance color (UNORM8 normalized)
uniform mat4 u_model; // Model matrix for transforming the vertex position
uniform mat3 u_normalMatrix; // Normal matrix for transforming normals
uniform float u_scale; // Scaling factor for the position
uniform float u_morphWeights[8];
uniform sampler2D u_morphPosTex;
uniform vec2 u_morphTexSize; // (width, height)
uniform int u_morphCount;    // number of rows/targets (0..MAX)
uniform sampler2D u_morphNormTex;
uniform vec2 u_morphNormTexSize;
uniform int u_morphNormCount;
uniform int u_morphIndices[8];
uniform mat4 u_jointMatrices[32];
uniform mat4 u_viewProjection;
uniform bool u_useInstancing;
uniform vec4 u_materialColor; // base color factor for non-instanced draws

// Frame-shared UBO (std140). Prefer using this view/proj when present.
layout(std140) uniform FrameUniforms {
    vec2 u_offscreenSize;
    vec2 u_logicalSize;
    vec4 u_timeDelta; // x=time, y=delta
    mat4 u_view;
    mat4 u_proj;
    vec4 u_cameraPos_frame; // xyz, pad (named differently to avoid conflicts)
};

out vec2 v_texcoord; // Texture coordinates to pass to the fragment shader
out vec3 v_normal; // Normal vector to pass to the fragment shader
out vec3 v_tangent; // Tangent vector in world space
out vec3 v_bitangent; // Bitangent vector in world space
out vec3 v_worldPos; // World position of the vertex to pass to the fragment shader
out vec4 v_color; // Per-vertex/instance color factor

// Octahedral decode (from [-1,1] encoded 2D to unit 3D)
vec3 octDecode(vec2 e) {
    vec3 n = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
    if (n.z < 0.0) {
        vec2 signV = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
        n.xy = (vec2(1.0) - vec2(abs(n.y), abs(n.x))) * signV;
    }
    return normalize(n);
}

void main() {
    vec3 pos = a_position;
    vec3 normal = a_normal;
    vec3 tangent = a_tangent.xyz;
    float tanSign = a_tangent.w;
    // Apply position morphs from texture (up to 4 targets)
    if (u_morphCount > 0) {
        float vx = (float(gl_VertexID) + 0.5) / u_morphTexSize.x;
        for (int i = 0; i < 8; ++i) {
            if (i >= u_morphCount) break;
            int row = u_morphIndices[i];
            float vy = (float(row) + 0.5) / u_morphTexSize.y;
            vec3 dp = texture(u_morphPosTex, vec2(vx, vy)).xyz;
            pos += dp * u_morphWeights[i];
        }
    }
    // Apply normal morphs from texture (up to 4 targets)
    if (u_morphNormCount > 0) {
        float vxn = (float(gl_VertexID) + 0.5) / u_morphNormTexSize.x;
        float totalW = 0.0;
        vec3 nAcc = normal; // start from base
        for (int i = 0; i < 8; ++i) {
            if (i >= u_morphNormCount) break;
            int rowN = u_morphIndices[i];
            float vyn = (float(rowN) + 0.5) / u_morphNormTexSize.y;
            vec2 enc = texture(u_morphNormTex, vec2(vxn, vyn)).rg;
            vec3 targ = octDecode(enc);
            float w = u_morphWeights[i];
            totalW += w;
            nAcc += (targ - normal) * w;
        }
        normal = normalize(nAcc);
    }
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
    mat4 instanceM = mat4(a_i0, a_i1, a_i2, a_i3);
    mat4 model = u_useInstancing ? instanceM : u_model;
    vec4 world = model * vec4(scaledPosition, 1.0); // Transform position to world space
    // Prefer UBO view/proj (backend binds per frame); fallback path remains available via u_viewProjection
    mat4 viewProjBlock = u_proj * u_view;
    gl_Position = viewProjBlock * model * vec4(scaledPosition, 1.0);
    v_worldPos = world.xyz; // Pass the world position to the fragment shader
    v_texcoord = a_texcoord; // Pass the texture coordinates to the fragment shader
    mat3 upper = mat3(model);
    mat3 nMat  = u_useInstancing ? transpose(inverse(upper)) : u_normalMatrix;
    // mat3 nMat = u_useInstancing ? mat3(model) : u_normalMatrix;
    v_normal = nMat * skinnedNormal; // Pass the normal vector to the fragment shader
    v_tangent = nMat * skinnedTangent;
    v_bitangent = nMat * skinnedBitangent;
    // Instance color when instancing; otherwise uniform material color
    v_color = u_useInstancing ? a_iColor : u_materialColor;
}
