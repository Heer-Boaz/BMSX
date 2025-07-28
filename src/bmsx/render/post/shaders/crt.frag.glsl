#version 300 es
precision mediump float;

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
uniform float u_noiseIntensity;
uniform vec3 u_colorBleed;
uniform float u_blurIntensity;
uniform vec3 u_glowColor;

// Input texture coordinates and output color
in vec2 v_texcoord;
out vec4 outputColor;

// Replace macros with constants
const float KERNEL_DIVISOR = 256.0;
const float KERNEL_WEIGHT_1 = 1.0;
const float KERNEL_WEIGHT_4 = 4.0;
const float KERNEL_WEIGHT_6 = 6.0;
const float KERNEL_WEIGHT_16 = 16.0;
const float KERNEL_WEIGHT_24 = 24.0;
const float KERNEL_WEIGHT_36 = 36.0;
const int KERNEL_SIZE = 5;
const int KERNEL_RADIUS = 2;

const vec3 LUMINANCE_WEIGHTS = vec3(0.299, 0.587, 0.114);
const int LUMINANCE_THRESHOLD = 1;
const int CENTER_INDEX = 0;
const float WEIGHT_INCREMENT = 1.0;

// Define a 5x5 blur kernel using the new constants
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

// Define constants for noise generation
const float NOISE_SEED_X = 12.9898;
const float NOISE_SEED_Y = 78.233;
const float NOISE_MULTIPLIER = 43758.5453;
const float NOISE_OFFSET = 19.19;

const float SCANLINE_INTERVAL = 2.0;
const float SCANLINE_DARKEN_FACTOR = 0.8; // Niet meer gebruikt, maar behouden voor compatibiliteit
const float SCANLINE_GAUSSIAN_SIGMA = 0.35; // Nieuw: Sigma voor gaussian beam profiel (tune dit voor scherpte; kleiner = scherpere lijnen)

const float BLUR_DEFAULT_CONTRAST_IF_NOT_APPLIED = 0.0;
const float GLOW_BRIGHTNESS_CLAMP = 0.5;
const float CENTER_SCALE = 0.5;
const float FRINGING_BASE_AMOUNT = 0.0010;
const float FRINGING_DISTANCE_MULTIPLIER = 0.0010;
const float FRINGING_CONTRAST_MULTIPLIER = 0.0005;
const float FRINGING_MIX_INTENSITY = 0.2;

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

// Optimized hash-based noise function with temporal variation
float hashNoise(vec2 uv, float time) {
    vec3 p = vec3(uv * 0.1, time * 0.1); // Scale down UV and time for better variation
    p = fract(p * vec3(NOISE_SEED_X, NOISE_SEED_Y, NOISE_MULTIPLIER));
    p += dot(p, p.yzx + NOISE_OFFSET);
    return fract((p.x + p.y) * p.z);
}

// Aangepaste functie voor scanlines met gaussian profiel en helderheidsafhankelijkheid
vec3 applyScanlines(vec3 color, vec2 fragCoord) {
    // Bereken positie relatief tot scanline center (voor interval 2.0: centers op even y)
    float scan_pos = mod(fragCoord.y + 0.5, SCANLINE_INTERVAL) - SCANLINE_INTERVAL / 2.0; // Center de gaussian op de lijn
    float gaussian = exp(-(scan_pos * scan_pos) / (2.0 * SCANLINE_GAUSSIAN_SIGMA * SCANLINE_GAUSSIAN_SIGMA)); // Gaussian intensiteit (piek=1, dal=0)

    // Maak afhankelijk van pixel-helderheid (minder scanlines op bright areas)
    float lum = dot(color, LUMINANCE_WEIGHTS);
    float intensity = mix(gaussian, 1.0, lum * 0.8); // Mix: bij lum=0 full gaussian, bij lum=1 minder effect (tune de 0.5)

    // Optioneel: pow voor gamma-achtige curve
    intensity = pow(intensity, 0.8); // Subtiele aanpassing voor naturally fading

    return color * intensity;
}

void main() {
    // Get the UV coordinates
    vec2 uv = v_texcoord;

    // Sample the texture color
    vec3 texColor = texture(u_texture, uv, 0.0).rgb;

    // Aangepaste volgorde: color bleed vroeg (signaal-artifact)
    if (u_applyColorBleed) {
        texColor += u_colorBleed;
    }

    // Fringing: nu eerder, met aanpassing om bleed in samples op te nemen voor consistentie
    BlurContrastResult result; // Verplaats contrast-berekening hierheen omdat fringing het nodig heeft
    if (u_applyBlur || u_applyFringing) { // Bereken contrast vroeg als nodig
        result = applyBlurAndContrast(uv);
    } else {
        result.contrast = BLUR_DEFAULT_CONTRAST_IF_NOT_APPLIED;
    }
    if (u_applyFringing) {
        // Calculate distance from the center
        vec2 center = u_resolution * CENTER_SCALE;
        float distanceFromCenter = length((uv * u_resolution * u_fragscale) - center) / length(center);

        // Determine the fringing amount
        float fringingAmount = FRINGING_BASE_AMOUNT + FRINGING_DISTANCE_MULTIPLIER * distanceFromCenter + FRINGING_CONTRAST_MULTIPLIER * result.contrast;

        // Apply color fringing met bleed toegevoegd aan samples
        float r = texture(u_texture, uv + vec2(fringingAmount, 0.0)).r;
        float g = texture(u_texture, uv).g;
        float b = texture(u_texture, uv - vec2(fringingAmount, 0.0)).b;
        vec3 color = vec3(r, g, b) + u_colorBleed; // Voeg bleed toe aan fringed samples voor consistentie

        // Combine
        texColor = mix(texColor, color, FRINGING_MIX_INTENSITY);
    }

    // Scanlines: na fringing, voor interactie
    if (u_applyScanlines) {
        texColor = applyScanlines(texColor, gl_FragCoord.xy);
    }

    // Blur: na scanlines, om te verzachten (gebruik bestaande result als blur aan is)
    if (u_applyBlur) {
        texColor = mix(texColor, result.blurredColor, u_blurIntensity);
    }

    // Glow: na blur, voor bloom op scanlines
    if (u_applyGlow) {
        vec3 glow = u_glowColor;
        float brightness = dot(texColor, LUMINANCE_WEIGHTS);
        texColor += glow * clamp(brightness, 0.0, GLOW_BRIGHTNESS_CLAMP);
    }

    // Noise: als laatste, als overlay-ruis
    if (u_applyNoise) {
        float noise = hashNoise(uv * u_resolution * u_fragscale + vec2(u_random), u_time);
        // texColor.rgb += vec3(noise) * u_noiseIntensity;
        texColor += dot(texColor, LUMINANCE_WEIGHTS) * noise * u_noiseIntensity;
    }

    // Set the final output color
    outputColor = vec4(texColor, 1.0);
}
