/*
 * backend.cpp - Software rendering backend implementation
 */

#include "backend.h"
#include <algorithm>
#include <cstring>
#include <cmath>

namespace bmsx {
namespace {

constexpr f32 kDitherLevels = 31.0f;
constexpr f32 kDitherStep = 1.0f / kDitherLevels;
constexpr f32 kDitherGamma = 2.2f;
constexpr f32 kDitherInvGamma = 1.0f / kDitherGamma;
constexpr f32 kBayerPattern[16] = {
    0.0f, 8.0f, 2.0f, 10.0f,
    12.0f, 4.0f, 14.0f, 6.0f,
    3.0f, 11.0f, 1.0f, 9.0f,
    15.0f, 7.0f, 13.0f, 5.0f,
};

inline f32 clamp01(f32 v) {
    return std::min(1.0f, std::max(0.0f, v));
}

inline f32 smoothstep(f32 edge0, f32 edge1, f32 x) {
    const f32 t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3.0f - 2.0f * t);
}

inline f32 linearToSrgb(f32 c) {
    return std::pow(std::max(0.0f, c), kDitherInvGamma);
}

inline f32 srgbToLinear(f32 c) {
    return std::pow(std::max(0.0f, c), kDitherGamma);
}

inline f32 bayer4x4(i32 x, i32 y) {
    const i32 xi = x & 3;
    const i32 yi = y & 3;
    return (kBayerPattern[(yi << 2) + xi] + 0.5f) / 16.0f;
}

} // namespace

/* ============================================================================
 * SoftwareBackend implementation
 * ============================================================================ */

SoftwareBackend::SoftwareBackend(u32* framebuffer, i32 width, i32 height, i32 pitch)
    : m_framebuffer(framebuffer)
    , m_width(width)
    , m_height(height)
    , m_pitch(pitch) {
    m_depthBuffer.resize(width * height, 1.0f);
}

SoftwareBackend::~SoftwareBackend() {
    m_textures.clear();
}

void SoftwareBackend::setFramebuffer(u32* fb, i32 width, i32 height, i32 pitch) {
    m_framebuffer = fb;
    m_width = width;
    m_height = height;
    m_pitch = pitch;
    m_depthBuffer.resize(width * height, 1.0f);
}

TextureHandle SoftwareBackend::createTexture(const u8* data, i32 width, i32 height, const TextureParams& params) {
    (void)params;

    auto tex = std::make_unique<SoftwareTexture>();
    tex->width = width;
    tex->height = height;
    tex->data.resize(width * height);

    // Convert RGBA8 to ARGB32
    for (i32 i = 0; i < width * height; ++i) {
        u8 r = data[i * 4 + 0];
        u8 g = data[i * 4 + 1];
        u8 b = data[i * 4 + 2];
        u8 a = data[i * 4 + 3];
        tex->data[i] = (a << 24) | (r << 16) | (g << 8) | b;
    }

    SoftwareTexture* ptr = tex.get();
    m_textures.push_back(std::move(tex));
    return static_cast<TextureHandle>(ptr);
}

TextureHandle SoftwareBackend::createSolidTexture2D(i32 width, i32 height, const Color& color) {
    auto tex = std::make_unique<SoftwareTexture>();
    tex->width = width;
    tex->height = height;
    tex->data.resize(width * height, color.toARGB32());

    SoftwareTexture* ptr = tex.get();
    m_textures.push_back(std::move(tex));
    return static_cast<TextureHandle>(ptr);
}

void SoftwareBackend::destroyTexture(TextureHandle handle) {
    auto* tex = static_cast<SoftwareTexture*>(handle);
    for (auto it = m_textures.begin(); it != m_textures.end(); ++it) {
        if (it->get() == tex) {
            m_textures.erase(it);
            break;
        }
    }
}

void SoftwareBackend::clear(const Color* color, const f32* depth) {
    if (color && m_framebuffer) {
        u32 packed = color->toARGB32();
        i32 pixelsPerRow = m_pitch / sizeof(u32);
        for (i32 y = 0; y < m_height; ++y) {
            u32* row = m_framebuffer + y * pixelsPerRow;
            for (i32 x = 0; x < m_width; ++x) {
                row[x] = packed;
            }
        }
    }

    if (depth) {
        std::fill(m_depthBuffer.begin(), m_depthBuffer.end(), *depth);
    }
}

PassEncoder SoftwareBackend::beginRenderPass(const RenderPassDesc& desc) {
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

    PassEncoder encoder;
    encoder.desc = desc;
    encoder.fbo = nullptr;  // Main framebuffer
    return encoder;
}

void SoftwareBackend::endRenderPass(PassEncoder& pass) {
    (void)pass;
    // No-op for software backend
}

void SoftwareBackend::draw(PassEncoder& pass, i32 first, i32 count) {
    (void)pass;
    (void)first;
    (void)count;
    m_stats.draws++;
    // Software drawing is done through the primitive methods
}

void SoftwareBackend::drawIndexed(PassEncoder& pass, i32 indexCount, i32 firstIndex) {
    (void)pass;
    (void)indexCount;
    (void)firstIndex;
    m_stats.drawIndexed++;
}

void SoftwareBackend::beginFrame() {
    m_stats = {};
}

void SoftwareBackend::endFrame() {
    // Frame complete - data is already in framebuffer
}

BackendCaps SoftwareBackend::getCaps() const {
    return {
        .maxColorAttachments = 1,
        .maxTextureSize = 4096,
        .supportsInstancing = false,
        .supportsDepthTexture = true
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Software-specific drawing primitives
// ─────────────────────────────────────────────────────────────────────────────

void SoftwareBackend::setPixel(i32 x, i32 y, const Color& color) {
    if (x < 0 || x >= m_width || y < 0 || y >= m_height) return;
    if (!m_framebuffer) return;

    i32 pixelsPerRow = m_pitch / sizeof(u32);
    m_framebuffer[y * pixelsPerRow + x] = color.toARGB32();
}

void SoftwareBackend::blendPixel(i32 x, i32 y, const Color& color) {
    if (x < 0 || x >= m_width || y < 0 || y >= m_height) return;
    if (!m_framebuffer) return;
    if (color.a <= 0.0f) return;

    i32 pixelsPerRow = m_pitch / sizeof(u32);
    i32 idx = y * pixelsPerRow + x;

    if (color.a >= 1.0f) {
        m_framebuffer[idx] = color.toARGB32();
        return;
    }

    // Alpha blend
    u32 dst = m_framebuffer[idx];
    f32 dstR = ((dst >> 16) & 0xFF) / 255.0f;
    f32 dstG = ((dst >> 8) & 0xFF) / 255.0f;
    f32 dstB = (dst & 0xFF) / 255.0f;

    f32 srcA = color.a;
    f32 invA = 1.0f - srcA;
    f32 outR = color.r * srcA + dstR * invA;
    f32 outG = color.g * srcA + dstG * invA;
    f32 outB = color.b * srcA + dstB * invA;

    u8 ri = static_cast<u8>(std::min(1.0f, outR) * 255.0f);
    u8 gi = static_cast<u8>(std::min(1.0f, outG) * 255.0f);
    u8 bi = static_cast<u8>(std::min(1.0f, outB) * 255.0f);
    m_framebuffer[idx] = (0xFF << 24) | (ri << 16) | (gi << 8) | bi;
}

void SoftwareBackend::drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color) {
    // Bresenham's line algorithm
    i32 dx = std::abs(x1 - x0);
    i32 dy = std::abs(y1 - y0);
    i32 sx = x0 < x1 ? 1 : -1;
    i32 sy = y0 < y1 ? 1 : -1;
    i32 err = dx - dy;

    while (true) {
        blendPixel(x0, y0, color);

        if (x0 == x1 && y0 == y1) break;

        i32 e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }
}

void SoftwareBackend::fillRect(i32 x, i32 y, i32 w, i32 h, const Color& color) {
    // Clip to screen bounds
    i32 x0 = std::max(0, x);
    i32 y0 = std::max(0, y);
    i32 x1 = std::min(m_width, x + w);
    i32 y1 = std::min(m_height, y + h);

    if (x0 >= x1 || y0 >= y1) return;

    i32 pixelsPerRow = m_pitch / sizeof(u32);

    if (color.a >= 1.0f) {
        // Opaque fill - fast path
        u32 packed = color.toARGB32();
        for (i32 py = y0; py < y1; ++py) {
            u32* row = m_framebuffer + py * pixelsPerRow;
            for (i32 px = x0; px < x1; ++px) {
                row[px] = packed;
            }
        }
    } else {
        // Alpha blended fill
        for (i32 py = y0; py < y1; ++py) {
            for (i32 px = x0; px < x1; ++px) {
                blendPixel(px, py, color);
            }
        }
    }
}

void SoftwareBackend::drawRect(i32 x, i32 y, i32 w, i32 h, const Color& color) {
    // Top and bottom edges
    drawLine(x, y, x + w - 1, y, color);
    drawLine(x, y + h - 1, x + w - 1, y + h - 1, color);
    // Left and right edges
    drawLine(x, y, x, y + h - 1, color);
    drawLine(x + w - 1, y, x + w - 1, y + h - 1, color);
}

void SoftwareBackend::blitTexture(TextureHandle tex, i32 srcX, i32 srcY, i32 srcW, i32 srcH,
                                   i32 dstX, i32 dstY, i32 dstW, i32 dstH, f32 depth,
                                   const Color& tint, bool flipH, bool flipV,
                                   const DitherParams& dither, bool useDepth) {
    auto* softTex = static_cast<SoftwareTexture*>(tex);
    if (!softTex || softTex->data.empty()) return;

    i32 pixelsPerRow = m_pitch / sizeof(u32);
    const bool applyDither = dither.enabled;
    const f32 ditherIntensity = dither.intensity;
    const i32 ditherJitter = dither.jitter;

    // Clipping
    i32 clipX0 = std::max(0, dstX);
    i32 clipY0 = std::max(0, dstY);
    i32 clipX1 = std::min(m_width, dstX + dstW);
    i32 clipY1 = std::min(m_height, dstY + dstH);

    if (clipX0 >= clipX1 || clipY0 >= clipY1) return;

    // Scale factors
    f32 scaleX = static_cast<f32>(srcW) / static_cast<f32>(dstW);
    f32 scaleY = static_cast<f32>(srcH) / static_cast<f32>(dstH);

    for (i32 dy = clipY0; dy < clipY1; ++dy) {
        i32 relY = dy - dstY;
        i32 sy = srcY + static_cast<i32>((flipV ? (dstH - 1 - relY) : relY) * scaleY);
        if (sy < 0 || sy >= softTex->height) continue;

        const i32 depthRow = dy * m_width;
        u32* dstRow = m_framebuffer + dy * pixelsPerRow;

        for (i32 dx = clipX0; dx < clipX1; ++dx) {
            i32 relX = dx - dstX;
            i32 sx = srcX + static_cast<i32>((flipH ? (dstW - 1 - relX) : relX) * scaleX);
            if (sx < 0 || sx >= softTex->width) continue;

            const i32 depthIndex = depthRow + dx;
            if (useDepth && depth > m_depthBuffer[depthIndex]) continue;

            u32 srcPixel = softTex->data[sy * softTex->width + sx];
            u8 srcA = (srcPixel >> 24) & 0xFF;
            if (srcA == 0) continue;

            u8 srcR = (srcPixel >> 16) & 0xFF;
            u8 srcG = (srcPixel >> 8) & 0xFF;
            u8 srcB = srcPixel & 0xFF;

            // Apply tint
            f32 r = (srcR / 255.0f) * tint.r;
            f32 g = (srcG / 255.0f) * tint.g;
            f32 b = (srcB / 255.0f) * tint.b;
            f32 a = (srcA / 255.0f) * tint.a;

            if (applyDither) {
                f32 colR = linearToSrgb(r);
                f32 colG = linearToSrgb(g);
                f32 colB = linearToSrgb(b);
                const f32 lumS = colR * 0.299f + colG * 0.587f + colB * 0.114f;
                const f32 guard = smoothstep(kDitherStep, 3.0f * kDitherStep, lumS) * ditherIntensity;
                const f32 threshold = bayer4x4(dx + ditherJitter, dy + ditherJitter) * clamp01(guard);
                const f32 qR = std::floor(colR * kDitherLevels + threshold) / kDitherLevels;
                const f32 qG = std::floor(colG * kDitherLevels + threshold) / kDitherLevels;
                const f32 qB = std::floor(colB * kDitherLevels + threshold) / kDitherLevels;
                r = srgbToLinear(clamp01(qR));
                g = srgbToLinear(clamp01(qG));
                b = srgbToLinear(clamp01(qB));
            }

            if (a >= 1.0f) {
                dstRow[dx] = (0xFF << 24) |
                             (static_cast<u8>(std::min(1.0f, r) * 255) << 16) |
                             (static_cast<u8>(std::min(1.0f, g) * 255) << 8) |
                             static_cast<u8>(std::min(1.0f, b) * 255);
            } else {
                Color col{r, g, b, a};
                blendPixel(dx, dy, col);
            }
            if (useDepth) m_depthBuffer[depthIndex] = depth;
        }
    }
}

} // namespace bmsx
