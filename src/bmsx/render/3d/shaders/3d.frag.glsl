#version 300 es
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
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
uniform vec3 u_cameraPos;
uniform vec3 u_ambientColor;
uniform float u_ambientIntensity;
const int MAX_DIR_LIGHTS = 4;
const int MAX_POINT_LIGHTS = 4;
uniform int u_numDirLights;
uniform vec3 u_dirLightDirection[MAX_DIR_LIGHTS];
uniform vec3 u_dirLightColor[MAX_DIR_LIGHTS];
uniform float u_dirLightIntensity[MAX_DIR_LIGHTS];
uniform int u_numPointLights;
uniform vec3 u_pointLightPosition[MAX_POINT_LIGHTS];
uniform vec3 u_pointLightColor[MAX_POINT_LIGHTS];
uniform float u_pointLightRange[MAX_POINT_LIGHTS];
uniform float u_pointLightIntensity[MAX_POINT_LIGHTS];

in vec2 v_texcoord;
in vec4 v_color_override;
flat in uint v_atlas_id;
in vec3 v_normal;
in vec3 v_tangent;
in vec3 v_bitangent;
in vec3 v_worldPos;

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
    vec4 texColor;
    if (u_useAlbedoTexture) {
        texColor = texture(u_albedoTexture, v_texcoord) * v_color_override;
    } else {
        switch (v_atlas_id) {
            case 0u:
                texColor = texture(u_texture0, v_texcoord);
                texColor *= v_color_override;
                break;
            case 1u:
                texColor = texture(u_texture1, v_texcoord);
                texColor *= v_color_override;
                break;
            default:
                texColor = v_color_override;
                break;
        }
    }

    vec3 normal = normalize(v_normal);
    if (u_useNormalTexture) {
        vec3 n = texture(u_normalTexture, v_texcoord).xyz * 2.0f - 1.0f;
        mat3 tbn = mat3(normalize(v_tangent), normalize(v_bitangent), normal);
        normal = normalize(tbn * n);
    }

    vec3 baseColor = texColor.rgb * u_materialColor.rgb;
    float metallic = u_metallicFactor;
    float roughness = u_roughnessFactor;
    if (u_useMetallicRoughnessTexture) {
        vec3 mr = texture(u_metallicRoughnessTexture, v_texcoord).rgb;
        roughness *= mr.g;
        metallic *= mr.b;
    }

    vec3 viewDir = normalize(u_cameraPos - v_worldPos);
    vec3 F0 = mix(vec3(0.04f), baseColor, metallic);
    vec3 lighting = u_ambientColor * u_ambientIntensity * baseColor;

    for (int i = 0; i < MAX_DIR_LIGHTS; i++) {
        if (i >= u_numDirLights)
            break;
        vec3 lightDir = normalize(-u_dirLightDirection[i]);
        float diff = max(dot(normal, lightDir), 0.0f);
        vec3 halfDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0f), 1.0f / (roughness * roughness + 0.001f));
        vec3 lightCol = u_dirLightColor[i] * u_dirLightIntensity[i];
        lighting += diff * baseColor * lightCol + spec * F0 * lightCol;
    }

    for (int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if (i >= u_numPointLights)
            break;
        vec3 lightVec = u_pointLightPosition[i] - v_worldPos;
        float dist = length(lightVec);
        if (dist < u_pointLightRange[i]) {
            float attenuation = 1.0f - dist / u_pointLightRange[i];
            vec3 lightDir = normalize(lightVec);
            float pdiff = max(dot(normal, lightDir), 0.0f);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0f), 1.0f / (roughness * roughness + 0.001f));
            vec3 lightCol = u_pointLightColor[i] * u_pointLightIntensity[i] * attenuation;
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
    outputColor = vec4(col, texColor.a);
}
