#version 300 es
precision highp float;

// Uniforms for texture, resolution, random value, time, and fragment scale
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_random;
uniform float u_time;
uniform float u_fragscale;

// Uniforms to control each effect
uniform bool u_applyNoise;
uniform bool u_applyColorBleed;
uniform bool u_applyBlur;
uniform bool u_applyGlow;
uniform bool u_applyFringing;

// Input texture coordinates and output color
in vec2 v_texcoord;
out vec4 outputColor;

// Define a 5x5 blur kernel
const float kernel[25] = float[](
    1.0/256.0, 4.0/256.0, 6.0/256.0, 4.0/256.0, 1.0/256.0,
    4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0,
    6.0/256.0, 24.0/256.0, 36.0/256.0, 24.0/256.0, 6.0/256.0,
    4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0,
    1.0/256.0, 4.0/256.0, 6.0/256.0, 4.0/256.0, 1.0/256.0
);

// Struct to hold the result of blur and contrast calculation
struct BlurContrastResult {
    vec3 blurredColor;
    float contrast;
};

// Function to apply blur and calculate contrast
BlurContrastResult applyBlurAndContrast(vec2 uv) {
    vec3 blurredColor = vec3(0.0);
    float centerLuminance = 0.0;
    float surroundingLuminance = 0.0;
    float totalWeight = 0.0;

    // Loop through the 5x5 kernel
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            // Calculate the offset for the current kernel element
            vec2 offset = vec2(x, y) / u_resolution * u_fragscale;
            // Sample the texture at the offset position
            vec3 color = texture(u_texture, uv + offset).rgb;
            // Accumulate the weighted color
            blurredColor += color * kernel[(y + 2) * 5 + (x + 2)];

            // Calculate luminance for contrast calculation
            if (abs(x) <= 1 && abs(y) <= 1) {
                float luminance = dot(color, vec3(0.299, 0.587, 0.114));
                if (x == 0 && y == 0) {
                    centerLuminance = luminance;
                } else {
                    surroundingLuminance += luminance;
                    totalWeight += 1.0;
                }
            }
        }
    }

    // Calculate the average surrounding luminance
    surroundingLuminance /= totalWeight;
    // Calculate the contrast
    float contrast = abs(centerLuminance - surroundingLuminance);

    return BlurContrastResult(blurredColor, contrast);
}

// Function to generate noise based on UV coordinates
float noise(vec2 uv) {
    return fract(sin(dot(uv, vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
    // Get the UV coordinates
    vec2 uv = v_texcoord;

    // Sample the texture color
    vec3 texColor = texture(u_texture, uv, 0.0).rgb;

    // Apply noise if enabled
    if (u_applyNoise) {
        float n = noise(uv * u_resolution * u_fragscale + vec2(u_random));
        texColor += vec3(n) * 0.1; // Adjust noise intensity as needed
    }

    // Apply color bleed if enabled
    if (u_applyColorBleed) {
        texColor += vec3(0.02, 0.0, 0.0); // Adjust bleed intensity and color
    }

    // Apply blur and calculate contrast if enabled
    BlurContrastResult result;
    if (u_applyBlur) {
        result = applyBlurAndContrast(uv);
        texColor = mix(texColor, result.blurredColor, .7); // Adjust blur intensity
    } else {
        result.contrast = 0.0; // Default contrast if blur is not applied
    }

    // Apply selective phosphor glow if enabled
    if (u_applyGlow) {
        vec3 glow = vec3(0.05, 0.02, 0.02);
        float brightness = dot(texColor, vec3(0.299, 0.587, 0.114)); // Luminance
        texColor += glow * clamp(brightness, 0.0, .5); // Glow only affects brighter areas
    }

    // Apply color fringing if enabled
    if (u_applyFringing) {
        // Calculate distance from the center (to simulate screen curvature effect)
        vec2 center = u_resolution * 0.5;
        float distanceFromCenter = length((uv * u_resolution * u_fragscale ) - center) / length(center);

        // Determine the fringing amount based on distance from the center and contrast
        float fringingAmount = 0.0010 + 0.0010 * distanceFromCenter + 0.0005 * result.contrast;

        // Apply color fringing
        vec3 color;
        color.r = texture(u_texture, uv + vec2(fringingAmount, 0.0)).r;
        color.g = texture(u_texture, uv).g;
        color.b = texture(u_texture, uv - vec2(fringingAmount, 0.0)).b;

        // Combine the color with the effects
        texColor = mix(texColor, color, 0.2); // Adjust the mix intensity
    }

    // Set the final output color
    outputColor = vec4(texColor, 1.0);
}