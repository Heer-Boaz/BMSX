#version 300 es
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform float u_ditherIntensity;
uniform vec3 u_materialColor;
uniform sampler2D u_shadowMap;
uniform mat4 u_lightMatrix;
uniform float u_shadowStrength;
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
in vec3 v_worldPos;

out vec4 outputColor;

const vec3 msx1_palette[16] = vec3[](
    vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), vec3(0.24, 0.67, 0.24), vec3(0.33, 0.76, 0.33),
    vec3(0.33, 0.33, 0.76), vec3(0.43, 0.43, 0.86), vec3(0.24, 0.67, 0.67), vec3(0.47, 0.76, 0.76),
    vec3(0.76, 0.33, 0.33), vec3(0.76, 0.43, 0.43), vec3(0.67, 0.67, 0.24), vec3(0.76, 0.76, 0.33),
    vec3(0.24, 0.47, 0.24), vec3(0.67, 0.33, 0.67), vec3(0.76, 0.76, 0.76), vec3(1.0, 1.0, 1.0)
);

vec3 quantize(vec3 color, int mode) {
    switch (mode) {
        case 0:
            return color; // No quantization
        case 1: // MSX1: 16 colors
            float minDist = 1e10;
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
            vec3 levels = vec3(7.0, 7.0, 3.0);
            return floor(color * levels + 0.5) / levels;
        case 3: // Playstation (PSX): 15-bit color
            vec3 psxLevels = vec3(31.0, 31.0, 31.0);
            return floor(color * psxLevels + 0.5) / psxLevels;
        default:
            return color; // Default case, no quantization
    }
}

// vec3 quantize(vec3 c) {
//     vec3 levels = vec3(31.0);
//     return floor(c * levels + 0.5) / levels;
// }

float bayer(vec2 pos) {
    int x = int(mod(pos.x,4.0));
    int y = int(mod(pos.y,4.0));
    int index = x + y*4;
    float[16] pattern = float[16](
        0.0, 8.0, 2.0,10.0,
        12.0,4.0,14.0,6.0,
        3.0,11.0,1.0,9.0,
        15.0,7.0,13.0,5.0
    );
    return (pattern[index]/16.0 - 0.5) * u_ditherIntensity;
}

void main() {
    vec4 texColor;
    if(v_atlas_id == 255u){
        texColor = v_color_override;
    } else {
        switch(v_atlas_id){
            case 0u:
                texColor = texture(u_texture0, v_texcoord);
                break;
            default:
                texColor = texture(u_texture1, v_texcoord);
                break;
        }
        texColor *= v_color_override;
    }

    vec3 normal = normalize(v_normal);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    vec3 lighting = u_ambientColor * u_ambientIntensity;

    for(int i = 0; i < MAX_DIR_LIGHTS; i++){
        if(i >= u_numDirLights) break;
        float diff = max(dot(normal, -u_dirLightDirection[i]), 0.0);
        lighting += diff * u_dirLightColor[i] * u_dirLightIntensity[i];
    }

    for(int i = 0; i < MAX_POINT_LIGHTS; i++){
        if(i >= u_numPointLights) break;
        vec3 lightVec = u_pointLightPosition[i] - v_worldPos;
        float dist = length(lightVec);
        if(dist < u_pointLightRange[i]){
            float attenuation = 1.0 - dist / u_pointLightRange[i];
            float pdiff = max(dot(normal, normalize(lightVec)), 0.0);
            lighting += pdiff * attenuation * u_pointLightColor[i] * u_pointLightIntensity[i];
        }
    }

    texColor.rgb *= u_materialColor;

    vec4 lightPos = u_lightMatrix * vec4(v_worldPos, 1.0);
    vec3 proj = lightPos.xyz / lightPos.w;
    float closest = texture(u_shadowMap, proj.xy * 0.5 + 0.5).r;
    float shadow = proj.z - 0.005 > closest ? u_shadowStrength : 1.0;

    vec3 col = quantize(texColor.rgb * lighting * shadow, 3);
    col += bayer(gl_FragCoord.xy);
    outputColor = vec4(col, texColor.a);
}
