#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

const int MESH_SURFACE_MASK = 1;
const int MAX_DIR_LIGHTS = 4;
const int MAX_POINT_LIGHTS = 4;

uniform sampler2D u_texture;
uniform int u_useTexture;
uniform vec3 u_cameraPosition;
uniform vec4 u_ambient_color_intensity;
uniform int u_numDirLights;
uniform vec4 u_dirLightDirection[MAX_DIR_LIGHTS];
uniform vec4 u_dirLightColorIntensity[MAX_DIR_LIGHTS];
uniform int u_numPointLights;
uniform vec4 u_pointLightPositionRange[MAX_POINT_LIGHTS];
uniform vec4 u_pointLightColorIntensity[MAX_POINT_LIGHTS];
uniform int u_surface;
uniform float u_alphaCutoff;
uniform float u_metallicFactor;
uniform float u_roughnessFactor;
uniform vec3 u_emissiveFactor;
uniform int u_doubleSided;
uniform int u_unlit;

varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_worldPos;
varying vec4 v_color;

vec4 meshSurfaceColor() {
	vec4 texel = vec4(1.0);
	if (u_useTexture != 0) {
		texel = texture2D(u_texture, v_uv);
	}
	return v_color * texel;
}

#define ADD_DIRECTIONAL_LIGHT(INDEX) \
	if (u_numDirLights > INDEX) { \
		vec3 lightDir = normalize(-u_dirLightDirection[INDEX].xyz); \
		float diffuse = max(dot(normal, lightDir), 0.0); \
		vec3 halfDir = normalize(lightDir + viewDir); \
		float specular = pow(max(dot(normal, halfDir), 0.0), specularPower); \
		vec3 lightColor = u_dirLightColorIntensity[INDEX].rgb * u_dirLightColorIntensity[INDEX].a; \
		lighting += diffuse * baseColor * lightColor + specular * f0 * lightColor; \
	}

#define ADD_POINT_LIGHT(INDEX) \
	if (u_numPointLights > INDEX) { \
		vec3 lightVector = u_pointLightPositionRange[INDEX].xyz - v_worldPos; \
		float distanceToLight = length(lightVector); \
		float range = u_pointLightPositionRange[INDEX].w; \
		if (distanceToLight < range) { \
			vec3 lightDir = lightVector / distanceToLight; \
			float diffuse = max(dot(normal, lightDir), 0.0); \
			vec3 halfDir = normalize(lightDir + viewDir); \
			float specular = pow(max(dot(normal, halfDir), 0.0), specularPower); \
			float attenuation = 1.0 - distanceToLight / range; \
			vec3 lightColor = u_pointLightColorIntensity[INDEX].rgb * u_pointLightColorIntensity[INDEX].a * attenuation; \
			lighting += diffuse * baseColor * lightColor + specular * f0 * lightColor; \
		} \
	}

vec3 meshLitColor(vec3 baseColor) {
	vec3 normal = normalize(v_normal);
	if (u_doubleSided != 0 && !gl_FrontFacing) {
		normal = -normal;
	}
	vec3 viewDir = normalize(u_cameraPosition - v_worldPos);
	float roughness = clamp(u_roughnessFactor, 0.04, 1.0);
	float specularPower = 1.0 / (roughness * roughness + 0.001);
	vec3 f0 = mix(vec3(0.04), baseColor, u_metallicFactor);
	vec3 lighting = baseColor * u_ambient_color_intensity.rgb * u_ambient_color_intensity.a + u_emissiveFactor;
	ADD_DIRECTIONAL_LIGHT(0)
	ADD_DIRECTIONAL_LIGHT(1)
	ADD_DIRECTIONAL_LIGHT(2)
	ADD_DIRECTIONAL_LIGHT(3)
	ADD_POINT_LIGHT(0)
	ADD_POINT_LIGHT(1)
	ADD_POINT_LIGHT(2)
	ADD_POINT_LIGHT(3)
	return lighting;
}

void main() {
	vec4 surfaceColor = meshSurfaceColor();
	if (u_surface == MESH_SURFACE_MASK && surfaceColor.a < u_alphaCutoff) {
		discard;
	}
	vec3 color = u_unlit != 0 ? surfaceColor.rgb : meshLitColor(surfaceColor.rgb);
	gl_FragColor = vec4(color, surfaceColor.a);
}
