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
uniform vec4 u_materialColor;
uniform sampler2D u_shadowMap;
uniform bool u_useShadowMap;
uniform mat4 u_lightMatrix;
uniform float u_shadowStrength;
// Frame-shared uniform block: required by this shader for camera, view/proj,
// ambient lighting, and per-frame timing.
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

const float[16] pattern = float[16](0.0f, 8.0f, 2.0f, 10.0f, 12.0f, 4.0f, 14.0f, 6.0f, 3.0f, 11.0f, 1.0f, 9.0f, 15.0f, 7.0f, 13.0f, 5.0f);

// Convert between sRGB and linear (approximate, gamma 2.2)
vec3 srgb_to_linear(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
	vec4 texColor = texture(u_albedoTexture, v_texcoord);
	float alpha = texColor.a * v_color.a;
	// Alpha coverage dither for masked surfaces (screen-space threshold)
	if (u_surface == 1) {
		ivec2 p = ivec2(gl_FragCoord.xy) & ivec2(3);
		int idx = p.x + (p.y << 2);
		float aThresh = (pattern[idx] + 0.5f) / 16.0f;
		if (alpha < aThresh) discard;
	}

	vec3 normal = normalize(v_normal);
	vec3 n = texture(u_normalTexture, v_texcoord).xyz * 2.0f - 1.0f;
	mat3 tbn = mat3(v_tangent, v_bitangent, normal);
	normal = normalize(tbn * n);

	vec3 baseColor = srgb_to_linear(texColor.rgb) * v_color.rgb;
	vec3 mr = texture(u_metallicRoughnessTexture, v_texcoord).rgb;
	float roughness = clamp(u_roughnessFactor * mr.g, 0.04f, 1.0f);
	float metallic = u_metallicFactor * mr.b;

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
	vec3 ndc = lightPos.xyz / lightPos.w;
	vec2 uv = ndc.xy * 0.5f + 0.5f;
	float dep = ndc.z * 0.5f + 0.5f;
	float inLight = step(0.0f, uv.x) * step(uv.x, 1.0f) *
							step(0.0f, uv.y) * step(uv.y, 1.0f) *
							step(0.0f, dep)  * step(dep, 1.0f);
	float bias = 0.0015f;
	float smEn = u_useShadowMap ? 1.0f : 0.0f;
	float closest = texture(u_shadowMap, uv).r;
	float shadow = (dep - bias > closest) ? u_shadowStrength : 1.0f;
	shadow = mix(1.0f, clamp(shadow, 0.0f, 1.0f), inLight * smEn);

	vec3 colLinear = max(lighting * shadow, vec3(0.0f));

	outputColor = vec4(colLinear, alpha);
}
