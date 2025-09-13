#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D u_texture0;
uniform sampler2D u_albedoTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_metallicRoughnessTexture;
uniform float u_metallicFactor;
uniform float u_roughnessFactor;
uniform float u_ditherIntensity;
uniform vec4 u_materialColor;
uniform sampler2D u_shadowMap;
uniform bool u_useShadowMap;
uniform mat4 u_lightMatrix;
uniform float u_shadowStrength;
// Frame-shared uniform block: required by this shader for camera, view/proj,
// ambient lighting, and per-frame timing (used for dither jitter).
layout(std140) uniform FrameUniforms {
	vec2 u_offscreenSize;
	vec2 u_logicalSize;
	vec4 u_timeDelta; // x=time, y=delta
	mat4 u_view;
	mat4 u_proj;
	vec4 u_cameraPos_frame; // xyz, pad
	vec4 u_ambient_frame;   // rgb,intensity
};
// (Fog disabled) — reserve space for future atmospheric params if needed
// Ambient provided via FrameUniforms (u_ambient_frame)
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
in highp vec3 v_worldPos;
in vec4 v_color;

out vec4 outputColor;

const vec3 msx1_palette[16] = vec3[](vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.24f, 0.67f, 0.24f), vec3(0.33f, 0.76f, 0.33f), vec3(0.33f, 0.33f, 0.76f), vec3(0.43f, 0.43f, 0.86f), vec3(0.24f, 0.67f, 0.67f), vec3(0.47f, 0.76f, 0.76f), vec3(0.76f, 0.33f, 0.33f), vec3(0.76f, 0.43f, 0.43f), vec3(0.67f, 0.67f, 0.24f), vec3(0.76f, 0.76f, 0.33f), vec3(0.24f, 0.47f, 0.24f), vec3(0.67f, 0.33f, 0.67f), vec3(0.76f, 0.76f, 0.76f), vec3(1.0f, 1.0f, 1.0f));
const float[16] pattern = float[16](0.0f, 8.0f, 2.0f, 10.0f, 12.0f, 4.0f, 14.0f, 6.0f, 3.0f, 11.0f, 1.0f, 9.0f, 15.0f, 7.0f, 13.0f, 5.0f);

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
	return (pattern[index] / 16.0f - 0.5f) * u_ditherIntensity;
}

// Convert between sRGB and linear (approximate, gamma 2.2)
vec3 srgb_to_linear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 linear_to_srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void main() {
	vec4 texColor = texture(u_albedoTexture, v_texcoord);
	float alpha = texColor.a * v_color.a;
	// Alpha coverage dither for masked surfaces (screen-space threshold)
	if (u_surface == 1) {
		int xi = int(mod(gl_FragCoord.x, 4.0f));
		int yi = int(mod(gl_FragCoord.y, 4.0f));
		int idx = xi + yi * 4;
		float aThresh = (pattern[idx] + 0.5f) / 16.0f;
		if (alpha < aThresh) discard;
	}

	vec3 normal = normalize(v_normal);
	vec3 n = texture(u_normalTexture, v_texcoord).xyz * 2.0f - 1.0f;
	mat3 tbn = mat3(normalize(v_tangent), normalize(v_bitangent), normal);
	normal = normalize(tbn * n);

	vec3 baseColor = srgb_to_linear(texColor.rgb) * v_color.rgb;
	float metallic = u_metallicFactor;
	float roughness = clamp(u_roughnessFactor, 0.04f, 1.0f);
	vec3 mr = texture(u_metallicRoughnessTexture, v_texcoord).rgb;
	roughness = clamp(roughness * mr.g, 0.04f, 1.0f);
	metallic *= mr.b;

	vec3 viewDir = normalize(u_cameraPos_frame.xyz - v_worldPos);
	vec3 F0 = mix(vec3(0.04f), baseColor, metallic);
	vec3 lighting = (u_ambient_frame.rgb * u_ambient_frame.a) * baseColor;

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
	vec2 uv = proj.xy * 0.5f + 0.5f;
	float inside = step(0.0f, proj.x) * step(0.0f, proj.y) * step(-1.0f, proj.x) * step(-1.0f, proj.y)
				 * step(0.0f, proj.z) * step(proj.z, 1.0f);
	float smEn = u_useShadowMap ? 1.0f : 0.0f;
	float closest = texture(u_shadowMap, uv).r;
	float shadow = (proj.z - 0.005f > closest) ? u_shadowStrength : 1.0f;
	shadow = mix(1.0f, clamp(shadow, 0.0f, 1.0f), inside * smEn);
	lighting = clamp(lighting, 0.0f, 1.0f);

	// Start from lit color (linear)
	vec3 colLinear = lighting * shadow;

	// Fog removed: keep lit color in linear
	colLinear = clamp(colLinear, 0.0f, 1.0f);

	// Dither in screen-space before quantization, operate in sRGB
	vec3 col = linear_to_srgb(colLinear);
	float jitter = fract(u_timeDelta.x * 60.0f);
	col = clamp(col + bayer(gl_FragCoord.xy + vec2(jitter * 4.0f)), 0.0f, 1.0f);
	col = quantize(col, 3);
	outputColor = vec4(col, alpha);
}
