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
uniform bool u_applyScanlines;
uniform bool u_applyBlur;
uniform bool u_applyGlow;
uniform bool u_applyFringing;

// Input texture coordinates and output color
in vec2 v_texcoord;
out vec4 outputColor;

// Define constants for the Gaussian blur kernel
#define KERNEL_DIVISOR 256.0
#define KERNEL_WEIGHT_1 1.0
#define KERNEL_WEIGHT_4 4.0
#define KERNEL_WEIGHT_6 6.0
#define KERNEL_WEIGHT_16 16.0
#define KERNEL_WEIGHT_24 24.0
#define KERNEL_WEIGHT_36 36.0

// Define a 5x5 blur kernel
const float kernel[25] = float[](
    KERNEL_WEIGHT_1 / KERNEL_DIVISOR, KERNEL_WEIGHT_4 / KERNEL_DIVISOR, KERNEL_WEIGHT_6 / KERNEL_DIVISOR, KERNEL_WEIGHT_4 / KERNEL_DIVISOR, KERNEL_WEIGHT_1 / KERNEL_DIVISOR,
    KERNEL_WEIGHT_4 / KERNEL_DIVISOR, KERNEL_WEIGHT_16 / KERNEL_DIVISOR, KERNEL_WEIGHT_24 / KERNEL_DIVISOR, KERNEL_WEIGHT_16 / KERNEL_DIVISOR, KERNEL_WEIGHT_4 / KERNEL_DIVISOR,
    KERNEL_WEIGHT_6 / KERNEL_DIVISOR, KERNEL_WEIGHT_24 / KERNEL_DIVISOR, KERNEL_WEIGHT_36 / KERNEL_DIVISOR, KERNEL_WEIGHT_24 / KERNEL_DIVISOR, KERNEL_WEIGHT_6 / KERNEL_DIVISOR,
    KERNEL_WEIGHT_4 / KERNEL_DIVISOR, KERNEL_WEIGHT_16 / KERNEL_DIVISOR, KERNEL_WEIGHT_24 / KERNEL_DIVISOR, KERNEL_WEIGHT_16 / KERNEL_DIVISOR, KERNEL_WEIGHT_4 / KERNEL_DIVISOR,
    KERNEL_WEIGHT_1 / KERNEL_DIVISOR, KERNEL_WEIGHT_4 / KERNEL_DIVISOR, KERNEL_WEIGHT_6 / KERNEL_DIVISOR, KERNEL_WEIGHT_4 / KERNEL_DIVISOR, KERNEL_WEIGHT_1 / KERNEL_DIVISOR
);

// Struct to hold the result of blur and contrast calculation
struct BlurContrastResult {
    vec3 blurredColor;
    float contrast;
};

// Define constants for kernel size, luminance weights, and luminance calculation
#define KERNEL_SIZE 5
#define KERNEL_RADIUS 2
#define LUMINANCE_WEIGHTS vec3(0.299, 0.587, 0.114)
#define LUMINANCE_THRESHOLD 1
#define CENTER_INDEX 0
#define WEIGHT_INCREMENT 1.0

// Function to apply blur and calculate contrast
BlurContrastResult applyBlurAndContrast(vec2 uv) {
    vec3 blurredColor = vec3(0.0);
    float centerLuminance = 0.0;
    float surroundingLuminance = 0.0;
    float totalWeight = 0.0;

    // Loop through the KERNEL_SIZE x KERNEL_SIZE kernel
    for (int y = -KERNEL_RADIUS; y <= KERNEL_RADIUS; y++) {
        for (int x = -KERNEL_RADIUS; x <= KERNEL_RADIUS; x++) {
            // Calculate the offset for the current kernel element
            vec2 offset = vec2(x, y) / u_resolution * u_fragscale;
            // Sample the texture at the offset position
            vec3 color = texture(u_texture, uv + offset).rgb;
            // Accumulate the weighted color
            blurredColor += color * kernel[(y + KERNEL_RADIUS) * KERNEL_SIZE + (x + KERNEL_RADIUS)];

            // Calculate luminance for contrast calculation
            if (abs(x) <= LUMINANCE_THRESHOLD && abs(y) <= LUMINANCE_THRESHOLD) {
                float luminance = dot(color, LUMINANCE_WEIGHTS);
                if (x == CENTER_INDEX && y == CENTER_INDEX) {
                    centerLuminance = luminance;
                } else {
                    surroundingLuminance += luminance;
                    totalWeight += WEIGHT_INCREMENT;
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

// Define constants for noise generation
#define NOISE_SEED_X 12.9898
#define NOISE_SEED_Y 78.233
#define NOISE_MULTIPLIER 43758.5453
#define NOISE_OFFSET 19.19

// Optimized hash-based noise function with temporal variation
float hashNoise(vec2 uv, float time) {
    vec3 p = vec3(uv * 0.1, time * 0.1); // Scale down UV and time for better variation
    p = fract(p * vec3(NOISE_SEED_X, NOISE_SEED_Y, NOISE_MULTIPLIER));
    p += dot(p, p.yzx + NOISE_OFFSET);
    return fract((p.x + p.y) * p.z);
}

#define SCANLINE_INTERVAL 2.0
#define SCANLINE_DARKEN_FACTOR 0.8

// Function to apply scanlines
vec3 applyScanlines(vec3 color, vec2 fragCoord) {
    if (mod(fragCoord.y, SCANLINE_INTERVAL) < 1.0) {
        color *= SCANLINE_DARKEN_FACTOR; // Darken every other row
    }
    return color;
}

// Define constants for noise, color bleed, blur, glow, and fringing
#define NOISE_INTENSITY 0.2
#define COLOR_BLEED vec3(0.02, 0.0, 0.0)
#define BLUR_INTENSITY 0.6
#define BLUR_DEFAULT_CONTRAST_IF_NOT_APPLIED 0.0
#define GLOW_COLOR vec3(0.05, 0.02, 0.02)
#define GLOW_BRIGHTNESS_CLAMP 0.5
#define CENTER_SCALE 0.5
#define FRINGING_BASE_AMOUNT 0.0010
#define FRINGING_DISTANCE_MULTIPLIER 0.0010
#define FRINGING_CONTRAST_MULTIPLIER 0.0005
#define FRINGING_MIX_INTENSITY 0.2

void main() {
    // Get the UV coordinates
    vec2 uv = v_texcoord;

    // Sample the texture color
    vec3 texColor = texture(u_texture, uv, 0.0).rgb;

    // Apply noise if enabled
    if (u_applyNoise) {
        // Generate noise once
        float noise = hashNoise(uv * u_resolution * u_fragscale + vec2(u_random), u_time);

        // Apply the same noise to all channels
        texColor.rgb += vec3(noise) * NOISE_INTENSITY;
    }

    // Apply color bleed if enabled
    if (u_applyColorBleed) {
        texColor += COLOR_BLEED; // Adjust bleed intensity and color
    }

    // Apply scanlines
    if (u_applyScanlines) {
        texColor = applyScanlines(texColor, gl_FragCoord.xy);
    }

    // Apply blur and calculate contrast if enabled
    BlurContrastResult result;
    if (u_applyBlur) {
        result = applyBlurAndContrast(uv);
        texColor = mix(texColor, result.blurredColor, BLUR_INTENSITY); // Adjust blur intensity
    } else {
        result.contrast = BLUR_DEFAULT_CONTRAST_IF_NOT_APPLIED; // Default contrast if blur is not applied
    }

    // Apply selective phosphor glow if enabled
    if (u_applyGlow) {
        vec3 glow = GLOW_COLOR;
        float brightness = dot(texColor, LUMINANCE_WEIGHTS); // Luminance
        texColor += glow * clamp(brightness, 0.0, GLOW_BRIGHTNESS_CLAMP); // Glow only affects brighter areas
    }

    // Apply color fringing if enabled
    if (u_applyFringing) {
        // Calculate distance from the center (to simulate screen curvature effect)
        vec2 center = u_resolution * CENTER_SCALE;
        float distanceFromCenter = length((uv * u_resolution * u_fragscale) - center) / length(center);

        // Determine the fringing amount based on distance from the center and contrast
        float fringingAmount = FRINGING_BASE_AMOUNT + FRINGING_DISTANCE_MULTIPLIER * distanceFromCenter + FRINGING_CONTRAST_MULTIPLIER * result.contrast;

        // Apply color fringing
        vec3 color;
        color.r = texture(u_texture, uv + vec2(fringingAmount, 0.0)).r;
        color.g = texture(u_texture, uv).g;
        color.b = texture(u_texture, uv - vec2(fringingAmount, 0.0)).b;

        // Combine the color with the effects
        texColor = mix(texColor, color, FRINGING_MIX_INTENSITY); // Adjust the mix intensity
    }

    // Set the final output color
    outputColor = vec4(texColor, 1.0);
}