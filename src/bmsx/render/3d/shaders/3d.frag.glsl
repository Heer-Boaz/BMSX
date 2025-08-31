#version 300 es
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_albedoTexture;
uniform bool u_useAlbedoTexture;
uniform sampler2D u_normalTexture;
uniform bool u_useNormalTexture;
uniform sampler2D u_metallicRoughnessTexture;
uniform bool u_useMetallicRoughnessTexture;
uniform float u_metallicFactor;
uniform float u_roughnessFactor;
uniform float u_ditherIntensity;
uniform vec4 u_materialColor;
uniform sampler2D u_shadowMap;
uniform bool u_useShadowMap;
uniform mat4 u_lightMatrix;
uniform float u_shadowStrength;
// Legacy uniform (kept for compatibility), but prefer FrameUniforms camera
uniform vec3 u_cameraPos;
layout(std140) uniform FrameUniforms {
    vec2 u_offscreenSize;
    vec2 u_logicalSize;
    vec4 u_timeDelta; // x=time, y=delta
    mat4 u_view;
    mat4 u_proj;
    vec4 u_cameraPos_frame; // xyz, pad
};
// Fog & atmospheric params
uniform vec3 u_fogColor;
uniform float u_fogDensity; // exponential (base) density parameter
uniform bool u_enableFog;
uniform int u_fogMode; // 0 = exp, 1 = exp2
uniform bool u_enableHeightFog;
uniform float u_heightFogStart;
uniform float u_heightFogEnd;
// Height-based color gradient (applied multiplicatively to baseColor prior to lighting)
uniform vec3 u_heightGradientLow;
uniform vec3 u_heightGradientHigh;
uniform bool u_enableHeightGradient;
uniform float u_heightMin;
uniform float u_heightMax;
uniform vec3 u_ambientColor;
uniform float u_ambientIntensity;
// Surface classification: 0=opaque, 1=masked(alpha-test), 2=transparent
uniform int u_surface;
uniform float u_alphaCutoff;
const int MAX_DIR_LIGHTS = 4;
const int MAX_POINT_LIGHTS = 4;
layout(std140) uniform DirLightBlock {
    int u_numDirLights;
    vec3 _padDir;
    vec4 u_dirLightDirection[MAX_DIR_LIGHTS];
    vec4 u_dirLightColor[MAX_DIR_LIGHTS];
    vec4 u_dirLightIntensity[MAX_DIR_LIGHTS];
};
layout(std140) uniform PointLightBlock {
    int u_numPointLights;
    vec3 _padPoint;
    vec4 u_pointLightPosition[MAX_POINT_LIGHTS];
    vec4 u_pointLightColor[MAX_POINT_LIGHTS];
    vec4 u_pointLightParams[MAX_POINT_LIGHTS]; // x=range, y=intensity
};

in vec2 v_texcoord;
in vec3 v_normal;
in vec3 v_tangent;
in vec3 v_bitangent;
in vec3 v_worldPos;
in vec4 v_color;

out vec4 outputColor;

const vec3 msx1_palette[16] = vec3[](vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.24f, 0.67f, 0.24f), vec3(0.33f, 0.76f, 0.33f), vec3(0.33f, 0.33f, 0.76f), vec3(0.43f, 0.43f, 0.86f), vec3(0.24f, 0.67f, 0.67f), vec3(0.47f, 0.76f, 0.76f), vec3(0.76f, 0.33f, 0.33f), vec3(0.76f, 0.43f, 0.43f), vec3(0.67f, 0.67f, 0.24f), vec3(0.76f, 0.76f, 0.33f), vec3(0.24f, 0.47f, 0.24f), vec3(0.67f, 0.33f, 0.67f), vec3(0.76f, 0.76f, 0.76f), vec3(1.0f, 1.0f, 1.0f));

vec3 quantize(vec3 color, int mode) {
    switch (mode) {
        case 0:
            return color; // No quantization
        case 1: // MSX1: 16 colors
            float minDist = 1e10f;
            vec3 bestColor;
            for (int i = 0; i < 16; i++) {
                float dist = length(color - msx1_palette[i]);
                if (dist < minDist) {
                    minDist = dist;
                    bestColor = msx1_palette[i];
                }
            }
            return bestColor;
        case 2: // MSX2: 256 colors
            vec3 levels = vec3(7.0f, 7.0f, 3.0f);
            return floor(color * levels + 0.5f) / levels;
        case 3: // Playstation (PSX): 15-bit color
            vec3 psxLevels = vec3(31.0f, 31.0f, 31.0f);
            return floor(color * psxLevels + 0.5f) / psxLevels;
        default:
            return color; // Default case, no quantization
    }
}

float bayer(vec2 pos) {
    int x = int(mod(pos.x, 4.0f));
    int y = int(mod(pos.y, 4.0f));
    int index = x + y * 4;
    float[16] pattern = float[16](0.0f, 8.0f, 2.0f, 10.0f, 12.0f, 4.0f, 14.0f, 6.0f, 3.0f, 11.0f, 1.0f, 9.0f, 15.0f, 7.0f, 13.0f, 5.0f);
    return (pattern[index] / 16.0f - 0.5f) * u_ditherIntensity;
}

void main() {
    vec4 texColor = u_useAlbedoTexture ? texture(u_albedoTexture, v_texcoord)
                                       : texture(u_texture0, v_texcoord);
    float alpha = texColor.a * v_color.a;
    if (u_surface == 1 && alpha < u_alphaCutoff) {
        discard;
    }

    vec3 normal = normalize(v_normal);
    if (u_useNormalTexture) {
        vec3 n = texture(u_normalTexture, v_texcoord).xyz * 2.0f - 1.0f;
        mat3 tbn = mat3(normalize(v_tangent), normalize(v_bitangent), normal);
        normal = normalize(tbn * n);
    }

    vec3 baseColor = texColor.rgb * v_color.rgb;
    if (u_enableHeightGradient) {
        float hT = clamp((v_worldPos.y - u_heightMin) / max(0.0001, (u_heightMax - u_heightMin)), 0.0, 1.0);
        vec3 hColor = mix(u_heightGradientLow, u_heightGradientHigh, hT);
        baseColor *= hColor; // apply gradient tint
    }
    float metallic = u_metallicFactor;
    float roughness = u_roughnessFactor;
    if (u_useMetallicRoughnessTexture) {
        vec3 mr = texture(u_metallicRoughnessTexture, v_texcoord).rgb;
        roughness *= mr.g;
        metallic *= mr.b;
    }

    vec3 viewDir = normalize(u_cameraPos_frame.xyz - v_worldPos);
    vec3 F0 = mix(vec3(0.04f), baseColor, metallic);
    vec3 lighting = u_ambientColor * u_ambientIntensity * baseColor;

    for (int i = 0; i < MAX_DIR_LIGHTS; i++) {
        if (i >= u_numDirLights)
            break;
        vec3 lightDir = normalize(-u_dirLightDirection[i].xyz);
        float diff = max(dot(normal, lightDir), 0.0f);
        vec3 halfDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0f), 1.0f / (roughness * roughness + 0.001f));
        vec3 lightCol = u_dirLightColor[i].xyz * u_dirLightIntensity[i].x;
        lighting += diff * baseColor * lightCol + spec * F0 * lightCol;
    }

    for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if (i >= u_numPointLights)
            break;
        vec3 lightVec = u_pointLightPosition[i].xyz - v_worldPos;
        float dist = length(lightVec);
        if (dist < u_pointLightParams[i].x) {
            float attenuation = 1.0f - dist / u_pointLightParams[i].x;
            vec3 lightDir = normalize(lightVec);
            float pdiff = max(dot(normal, lightDir), 0.0f);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0f), 1.0f / (roughness * roughness + 0.001f));
            vec3 lightCol = u_pointLightColor[i].xyz * u_pointLightParams[i].y * attenuation;
            lighting += pdiff * baseColor * lightCol + spec * F0 * lightCol;
        }
    }

    vec4 lightPos = u_lightMatrix * vec4(v_worldPos, 1.0f);
    vec3 proj = lightPos.xyz / lightPos.w;
    float shadow;
    if (!u_useShadowMap) {
        shadow = 1.0f; // No shadow map, full lighting
    } else if (proj.z < 0.0f || proj.z > 1.0f || proj.x < -1.0f || proj.x > 1.0f || proj.y < -1.0f || proj.y > 1.0f) {
        shadow = 1.0f; // Outside shadow map bounds, no shadow
    } else {
        // Sample the shadow map
        float closest = texture(u_shadowMap, proj.xy * 0.5f + 0.5f).r;
        shadow = proj.z - 0.005f > closest ? u_shadowStrength : 1.0f;
        shadow = clamp(shadow, 0.0f, 1.0f); // Ensure shadow is clamped between 0 and 1
    }
    lighting = clamp(lighting, 0.0f, 1.0f);

    // Apply dithering
    vec3 col = quantize(lighting * shadow, 3);
    col += bayer(gl_FragCoord.xy);

    // Apply dithering to alpha channel if needed (this is how the PSP does it)
    if (texColor.a < 1.0f) {
        float ditherAlpha = bayer(v_texcoord * vec2(256.0f, 256.0f)) * u_ditherIntensity; // Texture-space voor object-binding
        texColor.a = clamp(texColor.a + ditherAlpha, 0.0f, 1.0f);
    }
    if (u_enableFog) {
        float d = length(u_cameraPos - v_worldPos);
        float density = u_fogDensity;
        float fogFactor;
        if (u_fogMode == 1) { // exp2 (more natural smoothness for large scenes)
            // Factor = exp(-(density^2) * d^2)
            float dd = d * d;
            fogFactor = clamp(exp(-(density * density) * dd), 0.0, 1.0);
        } else { // classic exponential
            // Factor = exp(-density * d)
            fogFactor = clamp(exp(-density * d), 0.0, 1.0);
        }
        if (u_enableHeightFog) {
            float hStart = min(u_heightFogStart, u_heightFogEnd);
            float hEnd = max(u_heightFogStart, u_heightFogEnd);
            float span = max(0.0001, hEnd - hStart);
            // Ground factor: 1 at or below start, 0 at/above end.
            float groundFactor = 1.0 - clamp((v_worldPos.y - hStart) / span, 0.0, 1.0);
            // Blend ground factor into distance fog (bias to not overpower distance fade).
            fogFactor *= mix(1.0, groundFactor, 0.85);
        }
        col = mix(u_fogColor, col, fogFactor);
    }
    outputColor = vec4(col, alpha);
}
