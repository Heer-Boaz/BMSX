/*
 * crt_pipeline_gles2.cpp - GLES2 CRT post-processing pipeline
 */

#include "crt_pipeline_gles2.h"

#include "../core/engine.h"
#include <cstdlib>
#include <cstdio>

namespace bmsx {
namespace CRTPipeline {
namespace {

constexpr int kTexUnitPostProcess = 3;

struct CRTGLES2State {
    GLuint program = 0;
    GLint attrib_pos = -1;
    GLint attrib_uv = -1;
    GLint uniform_resolution = -1;
    GLint uniform_src_resolution = -1;
    GLint uniform_scale = -1;
    GLint uniform_fragscale = -1;
    GLint uniform_time = -1;
    GLint uniform_random = -1;
    GLint uniform_apply_noise = -1;
    GLint uniform_apply_color_bleed = -1;
    GLint uniform_apply_scanlines = -1;
    GLint uniform_apply_blur = -1;
    GLint uniform_apply_glow = -1;
    GLint uniform_apply_fringing = -1;
    GLint uniform_apply_aperture = -1;
    GLint uniform_noise_intensity = -1;
    GLint uniform_color_bleed = -1;
    GLint uniform_blur_intensity = -1;
    GLint uniform_glow_color = -1;
    GLint uniform_texture = -1;
    GLuint vbo_pos = 0;
    GLuint vbo_uv = 0;
    i32 width = -1;
    i32 height = -1;
};

CRTGLES2State g_crt;

const char* kCRTVertexShader = R"(
precision mediump float;

attribute vec2 a_position;
attribute vec2 a_texcoord;

uniform vec2 u_resolution;
uniform float u_scale;

varying vec2 v_texcoord;

void main() {
    vec2 scaledPosition = a_position * u_scale;
    vec2 clipSpace = ((scaledPosition / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0);
    gl_Position = vec4(clipSpace, 0.0, 1.0);
    v_texcoord = a_texcoord;
}
)";

const char* kCRTFragmentShader = R"(
precision mediump float;

uniform sampler2D u_texture;
uniform vec2 u_srcResolution;
uniform float u_fragscale;

uniform float u_time;
uniform float u_random;

uniform float u_applyNoise;
uniform float u_applyColorBleed;
uniform float u_applyScanlines;
uniform float u_applyBlur;
uniform float u_applyGlow;
uniform float u_applyFringing;
uniform float u_applyAperture;

uniform float u_noiseIntensity;
uniform vec3 u_colorBleed;
uniform float u_blurIntensity;
uniform vec3 u_glowColor;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

const float SCANLINE_INTERVAL = 1.0;
const float APERTURE_STRENGTH = 0.08;
const float GLOW_BRIGHTNESS_CLAMP = 0.6;

const float FRINGING_BASE_PX       = 0.8;
const float FRINGING_QUAD_COEF     = 2.5;
const float FRINGING_CONTRAST_COEF = 0.4;
const float FRINGING_MIX           = 0.11;

const float FRINGING_OFFSET = 0.5;
const float BLUR_FOOTPRINT_PX = 0.5;

const float BLACK_CUTOFF = 0.015;
const float BLACK_SOFT   = 0.060;

const float K_NORM = 1.0 / 16.0;

varying vec2 v_texcoord;

vec3 toLinear(vec3 c){ return c; }
vec3 toSRGB(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }

float hashNoise(vec2 uv, float t){
    vec3 p = vec3(uv * 0.1, t * 0.1);
    p = fract(p * vec3(12.9898, 78.233, 43758.5453));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

struct BlurContrast { vec3 blurred; float contrast; };

BlurContrast applyBlurAndContrast(vec2 uv, vec2 texel, float footprintPx){
    vec2 stepUV = texel * footprintPx;
    vec3 c00 = texture2D(u_texture, uv + vec2(-stepUV.x, -stepUV.y)).rgb;
    vec3 c10 = texture2D(u_texture, uv + vec2(0.0, -stepUV.y)).rgb;
    vec3 c20 = texture2D(u_texture, uv + vec2(stepUV.x, -stepUV.y)).rgb;
    vec3 c01 = texture2D(u_texture, uv + vec2(-stepUV.x, 0.0)).rgb;
    vec3 c11 = texture2D(u_texture, uv).rgb;
    vec3 c21 = texture2D(u_texture, uv + vec2(stepUV.x, 0.0)).rgb;
    vec3 c02 = texture2D(u_texture, uv + vec2(-stepUV.x, stepUV.y)).rgb;
    vec3 c12 = texture2D(u_texture, uv + vec2(0.0, stepUV.y)).rgb;
    vec3 c22 = texture2D(u_texture, uv + vec2(stepUV.x, stepUV.y)).rgb;

    vec3 accum = c11 * 4.0;
    accum += (c10 + c01 + c21 + c12) * 2.0;
    accum += c00 + c20 + c02 + c22;
    vec3 blurred = accum * K_NORM;

    float centerLum = dot(c11, LUMA);
    vec3 neighSum = c00 + c10 + c20 + c01 + c21 + c02 + c12 + c22;
    float neighAvg = dot(neighSum * (1.0 / 8.0), LUMA);

    BlurContrast bc;
    bc.blurred = blurred;
    bc.contrast = abs(centerLum - neighAvg);
    return bc;
}

const float SCANLINE_DEPTH = 0.07;

vec3 applyScanlines(vec3 colorLinear, vec2 uv, vec2 srcPxRes){
    float row   = floor(uv.y * srcPxRes.y);
    float phase = cos(3.14159265359 * row);

    float lum = dot(colorLinear, LUMA);
    float A   = mix(SCANLINE_DEPTH, 0.12, clamp(lum, 0.0, 1.0));

    float m = 1.0 - A * (0.5 - 0.5 * phase);
    m      /= (1.0 - 0.5 * A);

    float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
    return colorLinear * (1.0 + k * (m - 1.0));
}

vec3 applyApertureMask(vec3 colorLinear, vec2 uv, vec2 srcPxRes){
    float x_src = uv.x * srcPxRes.x;
    float triad = 0.5 + 0.5 * cos(6.2831853 * x_src);
    vec3  mask  = vec3(1.0 + APERTURE_STRENGTH * triad,
                       1.0,
                       1.0 - APERTURE_STRENGTH * triad);

    float lum = dot(colorLinear, LUMA);
    float k   = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
    return colorLinear * (1.0 + k * (mask - 1.0));
}

vec3 applyFringing(vec3 color, vec2 uv, vec2 texel, float contrast, float mixAmount){
    vec2 dUV = uv - vec2(FRINGING_OFFSET);
    float d  = length(dUV) / length(vec2(0.5));
    vec2 dir = (d > 0.0) ? (dUV / max(d, 1e-6)) : vec2(1.0, 0.0);

    float shiftPx = FRINGING_BASE_PX
                    + FRINGING_QUAD_COEF * (d * d)
                    + FRINGING_CONTRAST_COEF * contrast;

    vec2 shiftUV = dir * (shiftPx * texel);

    float r = texture2D(u_texture, uv + shiftUV).r;
    float g = texture2D(u_texture, uv).g;
    float b = texture2D(u_texture, uv - shiftUV).b;
    vec3 fringed = vec3(r, g, b);

    return mix(color, fringed, mixAmount);
}

vec3 applyNoise(vec3 color, vec2 uv, vec2 srcPxRes){
    float y_src    = uv.y * srcPxRes.y;
    float lineNoise= hashNoise(vec2(0.0, floor(y_src) + u_time * 30.0), 0.0) - 0.5;
    float pixNoise = hashNoise(uv * srcPxRes + vec2(u_random), u_time) - 0.5;
    float lum      = dot(color, LUMA);
    float n        = mix(pixNoise, lineNoise, 0.35);
    float k        = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lum);
    float amp      = u_noiseIntensity * mix(0.2, 1.0, 1.0 - lum);
    return color * (n * amp * k);
}

void main(){
    vec2 srcPxRes = u_srcResolution * u_fragscale;
    vec2 texel    = 1.0 / srcPxRes;

    vec3 color = texture2D(u_texture, v_texcoord).rgb;

    if (u_applyColorBleed > 0.5) color += u_colorBleed;

    BlurContrast bc;
    if (u_applyBlur > 0.5 || u_applyFringing > 0.5) {
        bc = applyBlurAndContrast(v_texcoord, texel, BLUR_FOOTPRINT_PX);
    } else {
        bc.blurred = color; bc.contrast = 0.0;
    }
    if (u_applyBlur > 0.5) color = mix(color, bc.blurred, clamp(u_blurIntensity, 0.0, 1.0));

    if (u_applyFringing > 0.5) color = applyFringing(color, v_texcoord, texel, bc.contrast, FRINGING_MIX);
    if (u_applyScanlines > 0.5) color = applyScanlines(color, v_texcoord, srcPxRes);
    if (u_applyAperture > 0.5) color = applyApertureMask(color, v_texcoord, srcPxRes);

    if (u_applyGlow > 0.5) {
        float b = dot(color, LUMA);
        float k = smoothstep(BLACK_CUTOFF, BLACK_SOFT, b);
        color += u_glowColor * clamp(b, 0.0, GLOW_BRIGHTNESS_CLAMP) * k;
    }

    if (u_applyNoise > 0.5) color += applyNoise(color, v_texcoord, srcPxRes);

    float lumFinal = dot(color, LUMA);
    float keep     = smoothstep(BLACK_CUTOFF, BLACK_SOFT, lumFinal);
    color *= keep;

    gl_FragColor = vec4(toSRGB(color), 1.0);
}
)";

GLuint compileShader(GLenum type, const char* src) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &src, nullptr);
    glCompileShader(shader);
    GLint status = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
    if (status == GL_FALSE) {
        char log[1024];
        glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
        std::fprintf(stderr, "[BMSX] GLES2 CRT shader compile failed: %s\n", log);
        std::abort();
    }
    return shader;
}

GLuint linkProgram(GLuint vs, GLuint fs) {
    GLuint program = glCreateProgram();
    glAttachShader(program, vs);
    glAttachShader(program, fs);
    glLinkProgram(program);
    GLint status = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &status);
    if (status == GL_FALSE) {
        char log[1024];
        glGetProgramInfoLog(program, sizeof(log), nullptr, log);
        std::fprintf(stderr, "[BMSX] GLES2 CRT program link failed: %s\n", log);
        std::abort();
    }
    glDeleteShader(vs);
    glDeleteShader(fs);
    return program;
}

void updateFullscreenQuad(i32 width, i32 height) {
    if (g_crt.width == width && g_crt.height == height) return;

    g_crt.width = width;
    g_crt.height = height;

    const float w = static_cast<float>(width);
    const float h = static_cast<float>(height);
    const float positions[12] = {
        0.0f, 0.0f,
        0.0f, h,
        w, 0.0f,
        w, 0.0f,
        0.0f, h,
        w, h
    };
    const float texcoords[12] = {
        0.0f, 1.0f,
        0.0f, 0.0f,
        1.0f, 1.0f,
        1.0f, 1.0f,
        0.0f, 0.0f,
        1.0f, 0.0f
    };

    glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_pos);
    glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);

    glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_uv);
    glBufferData(GL_ARRAY_BUFFER, sizeof(texcoords), texcoords, GL_STATIC_DRAW);
}

} // namespace

void initGLES2(OpenGLES2Backend* backend) {
    (void)backend;

    GLuint vs = compileShader(GL_VERTEX_SHADER, kCRTVertexShader);
    GLuint fs = compileShader(GL_FRAGMENT_SHADER, kCRTFragmentShader);
    g_crt.program = linkProgram(vs, fs);

    g_crt.attrib_pos = glGetAttribLocation(g_crt.program, "a_position");
    g_crt.attrib_uv = glGetAttribLocation(g_crt.program, "a_texcoord");

    g_crt.uniform_resolution = glGetUniformLocation(g_crt.program, "u_resolution");
    g_crt.uniform_src_resolution = glGetUniformLocation(g_crt.program, "u_srcResolution");
    g_crt.uniform_scale = glGetUniformLocation(g_crt.program, "u_scale");
    g_crt.uniform_fragscale = glGetUniformLocation(g_crt.program, "u_fragscale");
    g_crt.uniform_time = glGetUniformLocation(g_crt.program, "u_time");
    g_crt.uniform_random = glGetUniformLocation(g_crt.program, "u_random");
    g_crt.uniform_apply_noise = glGetUniformLocation(g_crt.program, "u_applyNoise");
    g_crt.uniform_apply_color_bleed = glGetUniformLocation(g_crt.program, "u_applyColorBleed");
    g_crt.uniform_apply_scanlines = glGetUniformLocation(g_crt.program, "u_applyScanlines");
    g_crt.uniform_apply_blur = glGetUniformLocation(g_crt.program, "u_applyBlur");
    g_crt.uniform_apply_glow = glGetUniformLocation(g_crt.program, "u_applyGlow");
    g_crt.uniform_apply_fringing = glGetUniformLocation(g_crt.program, "u_applyFringing");
    g_crt.uniform_apply_aperture = glGetUniformLocation(g_crt.program, "u_applyAperture");
    g_crt.uniform_noise_intensity = glGetUniformLocation(g_crt.program, "u_noiseIntensity");
    g_crt.uniform_color_bleed = glGetUniformLocation(g_crt.program, "u_colorBleed");
    g_crt.uniform_blur_intensity = glGetUniformLocation(g_crt.program, "u_blurIntensity");
    g_crt.uniform_glow_color = glGetUniformLocation(g_crt.program, "u_glowColor");
    g_crt.uniform_texture = glGetUniformLocation(g_crt.program, "u_texture");

    glGenBuffers(1, &g_crt.vbo_pos);
    glGenBuffers(1, &g_crt.vbo_uv);

    glUseProgram(g_crt.program);
    glUniform1i(g_crt.uniform_texture, kTexUnitPostProcess);
}

void shutdownGLES2(OpenGLES2Backend* backend) {
    (void)backend;
    if (g_crt.program != 0) glDeleteProgram(g_crt.program);
    if (g_crt.vbo_pos != 0) glDeleteBuffers(1, &g_crt.vbo_pos);
    if (g_crt.vbo_uv != 0) glDeleteBuffers(1, &g_crt.vbo_uv);
    g_crt = CRTGLES2State{};
}

void renderCRTGLES2(OpenGLES2Backend* backend, GameView* context, const CRTPipelineState& state) {
    (void)context;

    glUseProgram(g_crt.program);
    updateFullscreenQuad(state.width, state.height);

    backend->setRenderTarget(backend->backbuffer(), state.width, state.height);

    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_BLEND);

    glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_pos);
    glEnableVertexAttribArray(static_cast<GLuint>(g_crt.attrib_pos));
    glVertexAttribPointer(static_cast<GLuint>(g_crt.attrib_pos), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

    glBindBuffer(GL_ARRAY_BUFFER, g_crt.vbo_uv);
    glEnableVertexAttribArray(static_cast<GLuint>(g_crt.attrib_uv));
    glVertexAttribPointer(static_cast<GLuint>(g_crt.attrib_uv), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

    glUniform2f(g_crt.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
    glUniform2f(g_crt.uniform_src_resolution, static_cast<float>(state.baseWidth), static_cast<float>(state.baseHeight));
    glUniform1f(g_crt.uniform_scale, 1.0f);
    glUniform1f(g_crt.uniform_fragscale, static_cast<float>(state.width) / static_cast<float>(state.baseWidth));
    glUniform1f(g_crt.uniform_time, static_cast<float>(EngineCore::instance().clock()->now() / 1000.0));
    glUniform1f(g_crt.uniform_random, static_cast<float>(std::rand()) / static_cast<float>(RAND_MAX));

    glUniform1f(g_crt.uniform_apply_noise, state.options.applyNoise ? 1.0f : 0.0f);
    glUniform1f(g_crt.uniform_apply_color_bleed, state.options.applyColorBleed ? 1.0f : 0.0f);
    glUniform1f(g_crt.uniform_apply_scanlines, state.options.applyScanlines ? 1.0f : 0.0f);
    glUniform1f(g_crt.uniform_apply_blur, state.options.applyBlur ? 1.0f : 0.0f);
    glUniform1f(g_crt.uniform_apply_glow, state.options.applyGlow ? 1.0f : 0.0f);
    glUniform1f(g_crt.uniform_apply_fringing, state.options.applyFringing ? 1.0f : 0.0f);
    glUniform1f(g_crt.uniform_apply_aperture, state.options.applyAperture ? 1.0f : 0.0f);

    glUniform1f(g_crt.uniform_noise_intensity, state.options.noiseIntensity);
    glUniform3f(g_crt.uniform_color_bleed, state.options.colorBleed[0], state.options.colorBleed[1], state.options.colorBleed[2]);
    glUniform1f(g_crt.uniform_blur_intensity, state.options.blurIntensity);
    glUniform3f(g_crt.uniform_glow_color, state.options.glowColor[0], state.options.glowColor[1], state.options.glowColor[2]);

    backend->setActiveTextureUnit(kTexUnitPostProcess);
    backend->bindTexture2D(state.colorTex);

    glDrawArrays(GL_TRIANGLES, 0, 6);
}

} // namespace CRTPipeline
} // namespace bmsx
