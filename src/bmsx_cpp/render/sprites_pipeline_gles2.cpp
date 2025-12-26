/*
 * sprites_pipeline_gles2.cpp - GLES2 sprite pipeline
 */

#include "sprites_pipeline_gles2.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "../core/assets.h"
#include "../core/engine.h"
#include "render_queues.h"

namespace bmsx {
namespace SpritesPipeline {
namespace {

constexpr int kMaxSprites = 256;
constexpr int kVerticesPerSprite = 6;
constexpr int kPositionComponents = 2;
constexpr int kTexcoordComponents = 2;
constexpr int kZComponents = 1;
constexpr int kColorComponents = 4;
constexpr int kAtlasComponents = 1;

constexpr int kVertexCoordSize = kVerticesPerSprite * kPositionComponents;
constexpr int kTexcoordSize = kVerticesPerSprite * kTexcoordComponents;
constexpr int kZCoordSize = kVerticesPerSprite * kZComponents;
constexpr int kColorSize = kVerticesPerSprite * kColorComponents;
constexpr int kAtlasSize = kVerticesPerSprite * kAtlasComponents;

constexpr float kZCoordMax = 10000.0f;
constexpr float kDefaultZ = 0.0f;
constexpr float kEngineAtlasId = 254.0f;

constexpr int kTexUnitAtlasPrimary = 0;
constexpr int kTexUnitAtlasSecondary = 1;
constexpr int kTexUnitAtlasEngine = 11;

struct SpriteGLES2State {
  GLuint program = 0;
  GLint attrib_pos = -1;
  GLint attrib_uv = -1;
  GLint attrib_z = -1;
  GLint attrib_color = -1;
  GLint attrib_atlas = -1;
  GLint uniform_resolution = -1;
  GLint uniform_scale = -1;
  GLint uniform_tex0 = -1;
  GLint uniform_tex1 = -1;
  GLint uniform_tex2 = -1;
  GLint uniform_dither_intensity = -1;
  GLint uniform_dither_enabled = -1;
  GLint uniform_time = -1;
  GLuint vbo_pos = 0;
  GLuint vbo_uv = 0;
  GLuint vbo_z = 0;
  GLuint vbo_color = 0;
  GLuint vbo_atlas = 0;
  std::vector<float> positions;
  std::vector<float> texcoords;
  std::vector<float> zcoords;
  std::vector<float> colors;
  std::vector<float> atlas;
};

SpriteGLES2State g_sprite;

const char* kSpriteVertexShader = R"(
precision mediump float;

attribute vec2 a_position;
attribute vec2 a_texcoord;
attribute float a_pos_z;
attribute vec4 a_color_override;
attribute float a_atlas_id;

uniform vec2 u_resolution;
uniform float u_scale;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_atlas_id;

void main() {
    vec2 scaledPosition = a_position * u_scale;
    vec2 clipSpace = ((scaledPosition / u_resolution) * 2.0 - 1.0) * vec2(1.0, -1.0);
    gl_Position = vec4(clipSpace, a_pos_z, 1.0);
    v_texcoord = a_texcoord;
    v_color_override = a_color_override;
    v_atlas_id = a_atlas_id;
}
)";

const char* kSpriteFragmentShader = R"(
precision mediump float;

uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform float u_ditherIntensity;
uniform float u_ditherEnabled;
uniform float u_time;

varying vec2 v_texcoord;
varying vec4 v_color_override;
varying float v_atlas_id;

const float ENGINE_ATLAS_ID = 254.0;

float bayer4x4(vec2 p) {
    vec2 wrapped = mod(p, 4.0);
    int xi = int(wrapped.x);
    int yi = int(wrapped.y);
    vec4 row;
    if (yi == 0) row = vec4(0.0, 8.0, 2.0, 10.0);
    else if (yi == 1) row = vec4(12.0, 4.0, 14.0, 6.0);
    else if (yi == 2) row = vec4(3.0, 11.0, 1.0, 9.0);
    else row = vec4(15.0, 7.0, 13.0, 5.0);
    return (row[xi] + 0.5) / 16.0;
}

vec3 quantize_psx_ordered(vec3 sRGB, vec2 pix, float guard0_1) {
    vec3 levels = vec3(31.0);
    float threshold = bayer4x4(pix) * clamp(guard0_1, 0.0, 1.0);
    return floor(sRGB * levels + threshold) / levels;
}

vec3 srgb_to_linear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 linear_to_srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void main() {
    vec4 texColor;
    if (v_atlas_id < 0.5) {
        texColor = texture2D(u_texture0, v_texcoord);
    } else if (abs(v_atlas_id - ENGINE_ATLAS_ID) < 0.5) {
        texColor = texture2D(u_texture2, v_texcoord);
    } else {
        texColor = texture2D(u_texture1, v_texcoord);
    }
    texColor *= v_color_override;

    if (u_ditherEnabled > 0.5) {
        vec3 colS = linear_to_srgb(texColor.rgb);
        float stepSz = 1.0 / 31.0;
        float lumS = dot(colS, vec3(0.299, 0.587, 0.114));
        float guard = smoothstep(stepSz, 3.0 * stepSz, lumS) * u_ditherIntensity;
        int jitter = int(fract(u_time * 60.0) * 4.0);
        vec2 pix = gl_FragCoord.xy + vec2(float(jitter));
        vec3 qS = quantize_psx_ordered(colS, pix, guard);
        texColor.rgb = srgb_to_linear(clamp(qS, 0.0, 1.0));
    }
    gl_FragColor = texColor;
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
    std::fprintf(stderr, "[BMSX] GLES2 shader compile failed: %s\n", log);
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
    std::fprintf(stderr, "[BMSX] GLES2 program link failed: %s\n", log);
    std::abort();
  }
  glDeleteShader(vs);
  glDeleteShader(fs);
  return program;
}

void setupBuffers() {
  g_sprite.positions.resize(
      static_cast<size_t>(kMaxSprites * kVertexCoordSize));
  g_sprite.texcoords.resize(static_cast<size_t>(kMaxSprites * kTexcoordSize));
  g_sprite.zcoords.resize(static_cast<size_t>(kMaxSprites * kZCoordSize));
  g_sprite.colors.resize(static_cast<size_t>(kMaxSprites * kColorSize));
  g_sprite.atlas.resize(static_cast<size_t>(kMaxSprites * kAtlasSize));

  glGenBuffers(1, &g_sprite.vbo_pos);
  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_pos);
  glBufferData(GL_ARRAY_BUFFER, g_sprite.positions.size() * sizeof(float),
               nullptr, GL_DYNAMIC_DRAW);

  glGenBuffers(1, &g_sprite.vbo_uv);
  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_uv);
  glBufferData(GL_ARRAY_BUFFER, g_sprite.texcoords.size() * sizeof(float),
               nullptr, GL_DYNAMIC_DRAW);

  glGenBuffers(1, &g_sprite.vbo_z);
  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_z);
  glBufferData(GL_ARRAY_BUFFER, g_sprite.zcoords.size() * sizeof(float),
               nullptr, GL_DYNAMIC_DRAW);

  glGenBuffers(1, &g_sprite.vbo_color);
  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_color);
  glBufferData(GL_ARRAY_BUFFER, g_sprite.colors.size() * sizeof(float), nullptr,
               GL_DYNAMIC_DRAW);

  glGenBuffers(1, &g_sprite.vbo_atlas);
  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_atlas);
  glBufferData(GL_ARRAY_BUFFER, g_sprite.atlas.size() * sizeof(float), nullptr,
               GL_DYNAMIC_DRAW);
}

void setupAttributes() {
  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_pos);
  glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_pos));
  glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_pos),
                        kPositionComponents, GL_FLOAT, GL_FALSE, 0, nullptr);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_uv);
  glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_uv));
  glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_uv),
                        kTexcoordComponents, GL_FLOAT, GL_FALSE, 0, nullptr);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_z);
  glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_z));
  glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_z), kZComponents,
                        GL_FLOAT, GL_FALSE, 0, nullptr);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_color);
  glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_color));
  glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_color),
                        kColorComponents, GL_FLOAT, GL_FALSE, 0, nullptr);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_atlas);
  glEnableVertexAttribArray(static_cast<GLuint>(g_sprite.attrib_atlas));
  glVertexAttribPointer(static_cast<GLuint>(g_sprite.attrib_atlas),
                        kAtlasComponents, GL_FLOAT, GL_FALSE, 0, nullptr);
}

void writePositions(float* dst, float x, float y, float w, float h, float sx,
                    float sy) {
  const float x2 = x + w * sx;
  const float y2 = y + h * sy;
  dst[0] = x;
  dst[1] = y;
  dst[2] = x;
  dst[3] = y2;
  dst[4] = x2;
  dst[5] = y;
  dst[6] = x2;
  dst[7] = y;
  dst[8] = x;
  dst[9] = y2;
  dst[10] = x2;
  dst[11] = y2;
}

void writeZ(float* dst, float z) {
  for (int i = 0; i < kZCoordSize; i++) {
    dst[i] = z;
  }
}

void writeColor(float* dst, const Color& color) {
  for (int i = 0; i < kColorSize; i += kColorComponents) {
    dst[i + 0] = color.r;
    dst[i + 1] = color.g;
    dst[i + 2] = color.b;
    dst[i + 3] = color.a;
  }
}

void writeAtlas(float* dst, float atlas_id) {
  for (int i = 0; i < kAtlasSize; i++) {
    dst[i] = atlas_id;
  }
}

void updateBuffers(size_t spriteCount) {
  const size_t posCount = spriteCount * kVertexCoordSize;
  const size_t texCount = spriteCount * kTexcoordSize;
  const size_t zCount = spriteCount * kZCoordSize;
  const size_t colorCount = spriteCount * kColorSize;
  const size_t atlasCount = spriteCount * kAtlasSize;

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_pos);
  glBufferData(GL_ARRAY_BUFFER, posCount * sizeof(float),
               g_sprite.positions.data(), GL_DYNAMIC_DRAW);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_uv);
  glBufferData(GL_ARRAY_BUFFER, texCount * sizeof(float),
               g_sprite.texcoords.data(), GL_DYNAMIC_DRAW);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_z);
  glBufferData(GL_ARRAY_BUFFER, zCount * sizeof(float), g_sprite.zcoords.data(),
               GL_DYNAMIC_DRAW);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_color);
  glBufferData(GL_ARRAY_BUFFER, colorCount * sizeof(float),
               g_sprite.colors.data(), GL_DYNAMIC_DRAW);

  glBindBuffer(GL_ARRAY_BUFFER, g_sprite.vbo_atlas);
  glBufferData(GL_ARRAY_BUFFER, atlasCount * sizeof(float),
               g_sprite.atlas.data(), GL_DYNAMIC_DRAW);
}

}  // namespace

void initGLES2(OpenGLES2Backend* backend, GameView* context) {
  (void)backend;
  (void)context;

  GLuint vs = compileShader(GL_VERTEX_SHADER, kSpriteVertexShader);
  GLuint fs = compileShader(GL_FRAGMENT_SHADER, kSpriteFragmentShader);
  g_sprite.program = linkProgram(vs, fs);

  g_sprite.attrib_pos = glGetAttribLocation(g_sprite.program, "a_position");
  g_sprite.attrib_uv = glGetAttribLocation(g_sprite.program, "a_texcoord");
  g_sprite.attrib_z = glGetAttribLocation(g_sprite.program, "a_pos_z");
  g_sprite.attrib_color =
      glGetAttribLocation(g_sprite.program, "a_color_override");
  g_sprite.attrib_atlas = glGetAttribLocation(g_sprite.program, "a_atlas_id");

  g_sprite.uniform_resolution =
      glGetUniformLocation(g_sprite.program, "u_resolution");
  g_sprite.uniform_scale = glGetUniformLocation(g_sprite.program, "u_scale");
  g_sprite.uniform_tex0 = glGetUniformLocation(g_sprite.program, "u_texture0");
  g_sprite.uniform_tex1 = glGetUniformLocation(g_sprite.program, "u_texture1");
  g_sprite.uniform_tex2 = glGetUniformLocation(g_sprite.program, "u_texture2");
  g_sprite.uniform_dither_intensity =
      glGetUniformLocation(g_sprite.program, "u_ditherIntensity");
  g_sprite.uniform_dither_enabled =
      glGetUniformLocation(g_sprite.program, "u_ditherEnabled");
  g_sprite.uniform_time = glGetUniformLocation(g_sprite.program, "u_time");

  setupBuffers();

  glUseProgram(g_sprite.program);
  glUniform1i(g_sprite.uniform_tex0, kTexUnitAtlasPrimary);
  glUniform1i(g_sprite.uniform_tex1, kTexUnitAtlasSecondary);
  glUniform1i(g_sprite.uniform_tex2, kTexUnitAtlasEngine);
}

void shutdownGLES2(OpenGLES2Backend* backend) {
  (void)backend;
  if (g_sprite.program != 0) {
    glDeleteProgram(g_sprite.program);
  }
  if (g_sprite.vbo_pos != 0) glDeleteBuffers(1, &g_sprite.vbo_pos);
  if (g_sprite.vbo_uv != 0) glDeleteBuffers(1, &g_sprite.vbo_uv);
  if (g_sprite.vbo_z != 0) glDeleteBuffers(1, &g_sprite.vbo_z);
  if (g_sprite.vbo_color != 0) glDeleteBuffers(1, &g_sprite.vbo_color);
  if (g_sprite.vbo_atlas != 0) glDeleteBuffers(1, &g_sprite.vbo_atlas);
  g_sprite = SpriteGLES2State{};
}

void renderSpriteBatchGLES2(OpenGLES2Backend* backend, GameView* context,
                            const SpritesPipelineState& state) {
  (void)context;
  const i32 spriteCount = RenderQueues::beginSpriteQueue();
  if (spriteCount == 0) {
    return;
  }

  glUseProgram(g_sprite.program);
  setupAttributes();

  glDisable(GL_CULL_FACE);
  glDisable(GL_DEPTH_TEST);
  glDepthMask(GL_FALSE);
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

  const float baseWidth = static_cast<float>(state.baseWidth);
  const float baseHeight = static_cast<float>(state.baseHeight);
  glUniform2f(g_sprite.uniform_resolution, baseWidth, baseHeight);
  glUniform1f(g_sprite.uniform_dither_enabled,
              state.psxDither2dEnabled ? 1.0f : 0.0f);
  glUniform1f(g_sprite.uniform_dither_intensity, state.psxDither2dIntensity);
  glUniform1f(g_sprite.uniform_time,
              static_cast<float>(EngineCore::instance().totalTime()));

  const bool ideIsViewport = (state.viewportTypeIde == "viewport");
  const float ideScale =
      ideIsViewport ? 1.0f : (baseWidth / static_cast<float>(state.width));
  float currentScale = 1.0f;
  glUniform1f(g_sprite.uniform_scale, currentScale);

  backend->setActiveTextureUnit(kTexUnitAtlasPrimary);
  backend->bindTexture2D(state.atlasPrimaryTex);
  if (state.atlasSecondaryTex) {
    backend->setActiveTextureUnit(kTexUnitAtlasSecondary);
    backend->bindTexture2D(state.atlasSecondaryTex);
  }
  if (state.atlasEngineTex) {
    backend->setActiveTextureUnit(kTexUnitAtlasEngine);
    backend->bindTexture2D(state.atlasEngineTex);
  }

  size_t batchCount = 0;

  auto flush = [&]() {
    if (batchCount == 0) {
      return;
    }
    updateBuffers(batchCount);
    PassEncoder pass;
    backend->draw(pass, 0, static_cast<i32>(batchCount * kVerticesPerSprite));
    batchCount = 0;
  };

  RenderQueues::forEachSprite([&](const SpriteQueueItem& item, size_t) {
    const auto& options = item.options;
    const ImgMeta* imgmeta = item.imgmeta;

    const RenderLayer layer = options.layer.value_or(RenderLayer::World);
    const float desiredScale = (layer == RenderLayer::IDE) ? ideScale : 1.0f;
    if (desiredScale != currentScale) {
      flush();
      currentScale = desiredScale;
      glUniform1f(g_sprite.uniform_scale, currentScale);
    }

    const Vec3& pos = options.pos;
    const Vec2& scale = options.scale.value();
    const Color& colorize = options.colorize.value();
    const FlipOptions& flip = options.flip.value();
    const float zValue = (pos.z == 0.0f) ? kDefaultZ : pos.z;
    const float zNorm = 1.0f - (zValue / kZCoordMax);

    float* posDst = g_sprite.positions.data() + (batchCount * kVertexCoordSize);
    float* uvDst = g_sprite.texcoords.data() + (batchCount * kTexcoordSize);
    float* zDst = g_sprite.zcoords.data() + (batchCount * kZCoordSize);
    float* colorDst = g_sprite.colors.data() + (batchCount * kColorSize);
    float* atlasDst = g_sprite.atlas.data() + (batchCount * kAtlasSize);

    writePositions(posDst, pos.x, pos.y, static_cast<float>(imgmeta->width),
                   static_cast<float>(imgmeta->height), scale.x, scale.y);
    const auto& texcoords =
        flip.flip_h
            ? (flip.flip_v ? imgmeta->texcoords_fliphv
                           : imgmeta->texcoords_fliph)
            : (flip.flip_v ? imgmeta->texcoords_flipv : imgmeta->texcoords);
    std::memcpy(uvDst, texcoords.data(), kTexcoordSize * sizeof(float));
    writeZ(zDst, zNorm);
    writeColor(colorDst, colorize);
    writeAtlas(atlasDst, static_cast<float>(imgmeta->atlasid));

    batchCount++;
    if (batchCount >= static_cast<size_t>(kMaxSprites)) {
      flush();
    }
  });

  if (batchCount > 0) {
    flush();
  }

  glDepthMask(GL_TRUE);
}

}  // namespace SpritesPipeline
}  // namespace bmsx
