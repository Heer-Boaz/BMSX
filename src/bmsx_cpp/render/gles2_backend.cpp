/*
 * gles2_backend.cpp - OpenGL ES 2.0 backend implementation
 */

#include "gles2_backend.h"
#include <cstdio>
#include <vector>

namespace {
constexpr bool kGLES2VerboseLog = true;
}

namespace bmsx {

OpenGLES2Backend::OpenGLES2Backend(i32 width, i32 height)
    : m_width(width)
    , m_height(height) {
}

OpenGLES2Backend::~OpenGLES2Backend() = default;

TextureHandle OpenGLES2Backend::createTexture(const u8* data, i32 width, i32 height, const TextureParams& params) {
    (void)params;
    auto* tex = new GLES2Texture{};
    tex->width = width;
    tex->height = height;

    glGenTextures(1, &tex->id);
    glBindTexture(GL_TEXTURE_2D, tex->id);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, data);
    if (kGLES2VerboseLog) {
        std::fprintf(stderr,
                     "[BMSX][GLES2] createTexture id=%u size=%dx%d data=%p\n",
                     static_cast<unsigned>(tex->id), width, height,
                     static_cast<const void*>(data));
    }

    return static_cast<TextureHandle>(tex);
}

TextureHandle OpenGLES2Backend::createSolidTexture2D(i32 width, i32 height, const Color& color) {
    std::vector<u8> pixels(static_cast<size_t>(width * height * 4));
    const u8 r = static_cast<u8>(color.r * 255.0f);
    const u8 g = static_cast<u8>(color.g * 255.0f);
    const u8 b = static_cast<u8>(color.b * 255.0f);
    const u8 a = static_cast<u8>(color.a * 255.0f);
    for (size_t i = 0; i < pixels.size(); i += 4) {
        pixels[i + 0] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = a;
    }
    return createTexture(pixels.data(), width, height, TextureParams{});
}

void OpenGLES2Backend::destroyTexture(TextureHandle handle) {
    auto* tex = static_cast<GLES2Texture*>(handle);
    if (kGLES2VerboseLog) {
        std::fprintf(stderr, "[BMSX][GLES2] destroyTexture id=%u\n",
                     static_cast<unsigned>(tex->id));
    }
    glDeleteTextures(1, &tex->id);
    delete tex;
}

void OpenGLES2Backend::clear(const Color* color, const f32* depth) {
    GLbitfield mask = 0;
    if (color) {
        glClearColor(color->r, color->g, color->b, color->a);
        mask |= GL_COLOR_BUFFER_BIT;
    }
    if (depth) {
        glClearDepthf(*depth);
        mask |= GL_DEPTH_BUFFER_BIT;
    }
    if (mask == 0) {
        return;
    }
    glClear(mask);
}

PassEncoder OpenGLES2Backend::beginRenderPass(const RenderPassDesc& desc) {
    glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
    glViewport(0, 0, m_width, m_height);
    const ColorAttachmentSpec* colorSpec = nullptr;
    if (desc.color) {
        colorSpec = &*desc.color;
    } else if (!desc.colors.empty()) {
        colorSpec = &desc.colors.front();
    }

    const Color* clearColor = nullptr;
    Color colorValue;
    if (colorSpec && colorSpec->clear) {
        colorValue = *colorSpec->clear;
        clearColor = &colorValue;
    }

    const f32* clearDepth = nullptr;
    f32 depthValue = 1.0f;
    if (desc.depth && desc.depth->clearDepth) {
        depthValue = *desc.depth->clearDepth;
        clearDepth = &depthValue;
    }

    clear(clearColor, clearDepth);
    PassEncoder pass;
    pass.fbo = reinterpret_cast<void*>(static_cast<uintptr_t>(m_current_fbo));
    pass.desc = desc;
    return pass;
}

void OpenGLES2Backend::endRenderPass(PassEncoder& pass) {
    (void)pass;
}

void OpenGLES2Backend::draw(PassEncoder& pass, i32 first, i32 count) {
    (void)pass;
    glDrawArrays(GL_TRIANGLES, first, count);
    m_stats.draws++;
}

void OpenGLES2Backend::drawIndexed(PassEncoder& pass, i32 indexCount, i32 firstIndex) {
    (void)pass;
    const auto* offset = reinterpret_cast<const void*>(static_cast<uintptr_t>(firstIndex * sizeof(u16)));
    glDrawElements(GL_TRIANGLES, indexCount, GL_UNSIGNED_SHORT, offset);
    m_stats.drawIndexed++;
}

void OpenGLES2Backend::beginFrame() {
    m_stats = FrameStats{};
    // RetroArch can mutate GL state between frames; reset caches so bindings are refreshed.
    m_active_texture_unit = -1;
    m_bound_texture_2d_by_unit.fill(0);
    m_backbuffer_fbo = static_cast<GLuint>(m_get_framebuffer());
    if (kGLES2VerboseLog) {
        static u32 frameIndex = 0;
        frameIndex++;
        std::fprintf(stderr,
                     "[BMSX][GLES2] beginFrame #%u backbuffer_fbo=%u size=%dx%d\n",
                     frameIndex, static_cast<unsigned>(m_backbuffer_fbo), m_width,
                     m_height);
    }
    m_current_fbo = m_backbuffer_fbo;
    glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
    glViewport(0, 0, m_width, m_height);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_STENCIL_TEST);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
}

void OpenGLES2Backend::endFrame() {
    if (kGLES2VerboseLog) {
        std::fprintf(stderr, "[BMSX][GLES2] endFrame\n");
    }
    glUseProgram(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, 0);
    glDisableVertexAttribArray(0);
    glDisableVertexAttribArray(1);
    glDisableVertexAttribArray(2);
    glDisableVertexAttribArray(3);
    glDisableVertexAttribArray(4);
    glFinish();
}

BackendCaps OpenGLES2Backend::getCaps() const {
    BackendCaps caps;
    caps.supportsDepthTexture = false;
    return caps;
}

void OpenGLES2Backend::setViewportSize(i32 width, i32 height) {
    m_width = width;
    m_height = height;
}

void OpenGLES2Backend::setFramebufferGetter(FramebufferGetter getter) {
    m_get_framebuffer = getter;
}

void OpenGLES2Backend::onContextReset() {
    m_active_texture_unit = -1;
    m_bound_texture_2d_by_unit.fill(0);
}

void OpenGLES2Backend::onContextDestroy() {
    m_active_texture_unit = -1;
    m_bound_texture_2d_by_unit.fill(0);
}

void OpenGLES2Backend::setActiveTextureUnit(i32 unit) {
    if (unit == m_active_texture_unit) {
        return;
    }
    glActiveTexture(GL_TEXTURE0 + unit);
    m_active_texture_unit = unit;
    if (kGLES2VerboseLog) {
        std::fprintf(stderr, "[BMSX][GLES2] activeTexture unit=%d\n", unit);
    }
}

void OpenGLES2Backend::bindTexture2D(TextureHandle tex) {
    auto* gltex = static_cast<GLES2Texture*>(tex);
    const i32 unit = m_active_texture_unit;
    if (m_bound_texture_2d_by_unit[unit] == gltex->id) return;
    glBindTexture(GL_TEXTURE_2D, gltex->id);
    m_bound_texture_2d_by_unit[unit] = gltex->id;
    if (kGLES2VerboseLog) {
        std::fprintf(stderr, "[BMSX][GLES2] bindTexture2D unit=%d id=%u\n", unit,
                     static_cast<unsigned>(gltex->id));
    }
}

void OpenGLES2Backend::setRenderTarget(GLuint fbo, i32 width, i32 height) {
    m_current_fbo = fbo;
    m_width = width;
    m_height = height;
    glBindFramebuffer(GL_FRAMEBUFFER, m_current_fbo);
    glViewport(0, 0, m_width, m_height);
    if (kGLES2VerboseLog) {
        std::fprintf(stderr,
                     "[BMSX][GLES2] setRenderTarget fbo=%u size=%dx%d\n",
                     static_cast<unsigned>(fbo), width, height);
    }
}

} // namespace bmsx
