/*
 * backend.cpp - Software rendering backend implementation
 */

#include "backend.h"
#include <array>
#include <algorithm>
#include <cstring>
#include <cmath>

namespace bmsx {
namespace {

constexpr i32 kDitherLevels = 31;
constexpr f32 kDitherGuardEdge0 = 1.0f / static_cast<f32>(kDitherLevels);
constexpr f32 kDitherGuardEdge1 = 3.0f / static_cast<f32>(kDitherLevels);
constexpr u8 kBayerThreshold[16] = {
	8, 135, 39, 167,
	199, 71, 231, 103,
	55, 183, 23, 151,
	247, 119, 215, 87,
};

inline u8 expand5to8(i32 v5) {
	return static_cast<u8>((v5 << 3) | (v5 >> 2));
}

inline u8 quantize5Bit(i32 c8, i32 threshold) {
	i32 q5 = (c8 * kDitherLevels + threshold) / 255;
	if (q5 < 0) q5 = 0;
	if (q5 > kDitherLevels) q5 = kDitherLevels;
	return expand5to8(q5);
}

static std::array<u8, 256> buildDitherGuardLut() {
	std::array<u8, 256> lut{};
	for (i32 i = 0; i < 256; ++i) {
		const f32 lum = static_cast<f32>(i) / 255.0f;
		f32 t = (lum - kDitherGuardEdge0) / (kDitherGuardEdge1 - kDitherGuardEdge0);
		t = std::min(1.0f, std::max(0.0f, t));
		const f32 smooth = t * t * (3.0f - 2.0f * t);
		lut[i] = static_cast<u8>(smooth * 255.0f + 0.5f);
	}
	return lut;
}

static const std::array<u8, 256> kDitherGuardLut = buildDitherGuardLut();

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

void SoftwareBackend::updateTexture(TextureHandle handle, const u8* data, i32 width, i32 height, const TextureParams& params) {
	(void)params;
	auto* tex = static_cast<SoftwareTexture*>(handle);
	if (tex->width != width || tex->height != height) {
		tex->width = width;
		tex->height = height;
		tex->data.resize(static_cast<size_t>(width) * height);
	}
	for (i32 i = 0; i < width * height; ++i) {
		u8 r = data[i * 4 + 0];
		u8 g = data[i * 4 + 1];
		u8 b = data[i * 4 + 2];
		u8 a = data[i * 4 + 3];
		tex->data[i] = (a << 24) | (r << 16) | (g << 8) | b;
	}
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
	BackendCaps caps;
	caps.maxColorAttachments = 1;
	caps.maxTextureSize = 4096;
	caps.supportsInstancing = false;
	caps.supportsDepthTexture = true;
	return caps;
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

	const i32 pixelsPerRow = m_pitch / sizeof(u32);
	const bool applyDither = dither.enabled && dither.intensity != 0.0f;
	const i32 ditherIntensity = static_cast<i32>(dither.intensity * 255.0f + 0.5f);
	const i32 ditherJitter = dither.jitter;

	// Clipping
	i32 clipX0 = std::max(0, dstX);
	i32 clipY0 = std::max(0, dstY);
	i32 clipX1 = std::min(m_width, dstX + dstW);
	i32 clipY1 = std::min(m_height, dstY + dstH);

	if (clipX0 >= clipX1 || clipY0 >= clipY1) return;

	const i32 stepX = (srcW << 16) / dstW;
	const i32 stepY = (srcH << 16) / dstH;

	const i32 startRelX = clipX0 - dstX;
	const i32 startRelY = clipY0 - dstY;
	const i32 baseX = flipH ? (dstW - 1 - startRelX) : startRelX;
	const i32 baseY = flipV ? (dstH - 1 - startRelY) : startRelY;
	const i32 xStep = flipH ? -stepX : stepX;
	const i32 yStep = flipV ? -stepY : stepY;

	const i32 sx_fp_start = (srcX << 16) + baseX * stepX;

	const i32 tintR = static_cast<i32>(tint.r * 255.0f + 0.5f);
	const i32 tintG = static_cast<i32>(tint.g * 255.0f + 0.5f);
	const i32 tintB = static_cast<i32>(tint.b * 255.0f + 0.5f);
	const i32 tintA = static_cast<i32>(tint.a * 255.0f + 0.5f);

	const u32* srcData = softTex->data.data();
	const i32 texWidth = softTex->width;

	i32 sy_fp = (srcY << 16) + baseY * stepY;

	if (useDepth) {
		for (i32 dy = clipY0; dy < clipY1; ++dy) {
			const i32 sy = sy_fp >> 16;
			const u32* srcRow = srcData + sy * texWidth;
			u32* dstRow = m_framebuffer + dy * pixelsPerRow;
			const i32 depthRow = dy * m_width;
			const i32 ditherRow = ((dy + ditherJitter) & 3) << 2;

			i32 sx_fp = sx_fp_start;
			for (i32 dx = clipX0; dx < clipX1; ++dx) {
				const i32 depthIndex = depthRow + dx;
				if (depth > m_depthBuffer[depthIndex]) {
					sx_fp += xStep;
					continue;
				}

				const i32 sx = sx_fp >> 16;
				sx_fp += xStep;

				const u32 srcPixel = srcRow[sx];
				const i32 srcA = (srcPixel >> 24) & 0xFF;
				if (srcA == 0) continue;

				const i32 srcR = (srcPixel >> 16) & 0xFF;
				const i32 srcG = (srcPixel >> 8) & 0xFF;
				const i32 srcB = srcPixel & 0xFF;

				i32 r = (srcR * tintR + 127) / 255;
				i32 g = (srcG * tintG + 127) / 255;
				i32 b = (srcB * tintB + 127) / 255;
				i32 a = (srcA * tintA + 127) / 255;

				if (r < 0) r = 0;
				if (r > 255) r = 255;
				if (g < 0) g = 0;
				if (g > 255) g = 255;
				if (b < 0) b = 0;
				if (b > 255) b = 255;
				if (a <= 0) continue;
				if (a > 255) a = 255;

				if (applyDither) {
					const i32 lum = (r * 77 + g * 150 + b * 29) >> 8;
					const i32 guard = (static_cast<i32>(kDitherGuardLut[lum]) * ditherIntensity + 127) / 255;
					const i32 threshold = (static_cast<i32>(kBayerThreshold[ditherRow | ((dx + ditherJitter) & 3)]) * guard + 127) / 255;
					r = quantize5Bit(r, threshold);
					g = quantize5Bit(g, threshold);
					b = quantize5Bit(b, threshold);
				}

				if (a >= 255) {
					dstRow[dx] = (0xFF << 24) |
								 (static_cast<u32>(r) << 16) |
								 (static_cast<u32>(g) << 8) |
								 static_cast<u32>(b);
				} else {
					const u32 dst = dstRow[dx];
					const u32 invA = 255 - static_cast<u32>(a);

					const u32 dr = (dst >> 16) & 0xFF;
					const u32 dg = (dst >> 8) & 0xFF;
					const u32 db = dst & 0xFF;

					const u32 or_ = (static_cast<u32>(r) * a + dr * invA + 127) / 255;
					const u32 og = (static_cast<u32>(g) * a + dg * invA + 127) / 255;
					const u32 ob = (static_cast<u32>(b) * a + db * invA + 127) / 255;

					dstRow[dx] = 0xFF000000 | (or_ << 16) | (og << 8) | ob;
				}

				m_depthBuffer[depthIndex] = depth;
			}
			sy_fp += yStep;
		}
		return;
	}

	for (i32 dy = clipY0; dy < clipY1; ++dy) {
		const i32 sy = sy_fp >> 16;
		const u32* srcRow = srcData + sy * texWidth;
		u32* dstRow = m_framebuffer + dy * pixelsPerRow;
		const i32 ditherRow = ((dy + ditherJitter) & 3) << 2;

		i32 sx_fp = sx_fp_start;
		for (i32 dx = clipX0; dx < clipX1; ++dx) {
			const i32 sx = sx_fp >> 16;
			sx_fp += xStep;

			const u32 srcPixel = srcRow[sx];
			const i32 srcA = (srcPixel >> 24) & 0xFF;
			if (srcA == 0) continue;

			const i32 srcR = (srcPixel >> 16) & 0xFF;
			const i32 srcG = (srcPixel >> 8) & 0xFF;
			const i32 srcB = srcPixel & 0xFF;

			i32 r = (srcR * tintR + 127) / 255;
			i32 g = (srcG * tintG + 127) / 255;
			i32 b = (srcB * tintB + 127) / 255;
			i32 a = (srcA * tintA + 127) / 255;

			if (r < 0) r = 0;
			if (r > 255) r = 255;
			if (g < 0) g = 0;
			if (g > 255) g = 255;
			if (b < 0) b = 0;
			if (b > 255) b = 255;
			if (a <= 0) continue;
			if (a > 255) a = 255;

			if (applyDither) {
				const i32 lum = (r * 77 + g * 150 + b * 29) >> 8;
				const i32 guard = (static_cast<i32>(kDitherGuardLut[lum]) * ditherIntensity + 127) / 255;
				const i32 threshold = (static_cast<i32>(kBayerThreshold[ditherRow | ((dx + ditherJitter) & 3)]) * guard + 127) / 255;
				r = quantize5Bit(r, threshold);
				g = quantize5Bit(g, threshold);
				b = quantize5Bit(b, threshold);
			}

			if (a >= 255) {
				dstRow[dx] = (0xFF << 24) |
							 (static_cast<u32>(r) << 16) |
							 (static_cast<u32>(g) << 8) |
							 static_cast<u32>(b);
			} else {
				const u32 dst = dstRow[dx];
				const u32 invA = 255 - static_cast<u32>(a);

				const u32 dr = (dst >> 16) & 0xFF;
				const u32 dg = (dst >> 8) & 0xFF;
				const u32 db = dst & 0xFF;

				const u32 or_ = (static_cast<u32>(r) * a + dr * invA + 127) / 255;
				const u32 og = (static_cast<u32>(g) * a + dg * invA + 127) / 255;
				const u32 ob = (static_cast<u32>(b) * a + db * invA + 127) / 255;

				dstRow[dx] = 0xFF000000 | (or_ << 16) | (og << 8) | ob;
			}
		}
		sy_fp += yStep;
	}
}

} // namespace bmsx
