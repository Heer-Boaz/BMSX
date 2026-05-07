/*
 * backend.cpp - Software rendering backend implementation
 */

#include "backend.h"
#include "common/clamp.h"
#include "render/shared/software_pixels.h"
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
		t = clamp(t, 0.0f, 1.0f);
		const f32 smooth = t * t * (3.0f - 2.0f * t);
		lut[i] = static_cast<u8>(smooth * 255.0f + 0.5f);
	}
	return lut;
}

static const std::array<u8, 256> kDitherGuardLut = buildDitherGuardLut();

} // namespace

std::array<u8, 256> buildSrgbToLinearLut() {
	std::array<u8, 256> lut{};
	for (i32 i = 0; i < 256; ++i) {
		const f32 c = static_cast<f32>(i) / 255.0f;
		const f32 linear = c <= 0.04045f
			? c / 12.92f
			: std::pow((c + 0.055f) / 1.055f, 2.4f);
		lut[static_cast<size_t>(i)] = static_cast<u8>(std::round(linear * 255.0f));
	}
	return lut;
}

const std::array<u8, 256>& srgbToLinearLut() {
	static const std::array<u8, 256> lut = buildSrgbToLinearLut();
	return lut;
}

std::array<u8, 256> buildLinearToSrgbLut() {
	std::array<u8, 256> lut{};
	for (i32 i = 0; i < 256; ++i) {
		const f32 c = static_cast<f32>(i) / 255.0f;
		const f32 encoded = c <= 0.0031308f
			? c * 12.92f
			: 1.055f * std::pow(c, 1.0f / 2.4f) - 0.055f;
		lut[static_cast<size_t>(i)] = static_cast<u8>(std::round(encoded * 255.0f));
	}
	return lut;
}

const std::array<u8, 256>& linearToSrgbLut() {
	static const std::array<u8, 256> lut = buildLinearToSrgbLut();
	return lut;
}

static void convertRgbWithLut(const u8* src, size_t pixels, std::vector<u8>& out, const std::array<u8, 256>& lut) {
	out.resize(pixels * 4);
	for (size_t i = 0; i < pixels; ++i) {
		const size_t idx = i * 4;
		out[idx + 0] = lut[src[idx + 0]];
		out[idx + 1] = lut[src[idx + 1]];
		out[idx + 2] = lut[src[idx + 2]];
		out[idx + 3] = src[idx + 3];
	}
}

void convertSrgbToLinear(const u8* src, size_t pixels, std::vector<u8>& out) {
	const auto& lut = srgbToLinearLut();
	convertRgbWithLut(src, pixels, out, lut);
}

void convertLinearToSrgb(const u8* src, size_t pixels, std::vector<u8>& out) {
	const auto& lut = linearToSrgbLut();
	convertRgbWithLut(src, pixels, out, lut);
}

static const u8* prepareUploadData(const u8* data, i32 width, i32 height, const TextureParams& params, std::vector<u8>& linearized) {
	if (data && params.srgb) {
		const size_t pixels = static_cast<size_t>(width) * static_cast<size_t>(height);
		convertSrgbToLinear(data, pixels, linearized);
		return linearized.data();
	}
	return data;
}

static u32 packRgba8AsArgb32(const u8* pixel) {
	const u32 r = pixel[0];
	const u32 g = pixel[1];
	const u32 b = pixel[2];
	const u32 a = pixel[3];
	return (a << 24) | (r << 16) | (g << 8) | b;
}

static void uploadRgba8ToSoftwareTexture(SoftwareTexture& texture, const u8* data, i32 width, i32 height) {
	for (i32 i = 0; i < width * height; ++i) {
		texture.data[static_cast<size_t>(i)] = packRgba8AsArgb32(data + static_cast<size_t>(i) * 4u);
	}
}

inline i32 clampBlitByte(i32 value) {
	if (value < 0) return 0;
	if (value > 255) return 255;
	return value;
}

inline void ditherBlitRgb(i32& r, i32& g, i32& b, i32 ditherRow, i32 x, i32 ditherJitter, i32 ditherIntensity) {
	const i32 lum = (r * 77 + g * 150 + b * 29) >> 8;
	const i32 guard = (static_cast<i32>(kDitherGuardLut[lum]) * ditherIntensity + 127) / 255;
	const i32 threshold = (static_cast<i32>(kBayerThreshold[ditherRow | ((x + ditherJitter) & 3)]) * guard + 127) / 255;
	r = quantize5Bit(r, threshold);
	g = quantize5Bit(g, threshold);
	b = quantize5Bit(b, threshold);
}

inline u32 blendBlitRgb(u32 dst, i32 r, i32 g, i32 b, i32 a) {
	const u32 invA = 255 - static_cast<u32>(a);
	const u32 dr = (dst >> 16) & 0xFF;
	const u32 dg = (dst >> 8) & 0xFF;
	const u32 db = dst & 0xFF;
	const u32 outR = (static_cast<u32>(r) * a + dr * invA + 127) / 255;
	const u32 outG = (static_cast<u32>(g) * a + dg * invA + 127) / 255;
	const u32 outB = (static_cast<u32>(b) * a + db * invA + 127) / 255;
	return 0xFF000000 | (outR << 16) | (outG << 8) | outB;
}

inline bool shadeBlitPixel(u32 srcPixel,
							u32 dstPixel,
							i32 tintR,
							i32 tintG,
							i32 tintB,
							i32 tintA,
							bool applyDither,
							i32 ditherRow,
							i32 x,
							i32 ditherJitter,
							i32 ditherIntensity,
							u32& outPixel) {
	const i32 srcA = (srcPixel >> 24) & 0xFF;
	if (srcA == 0) return false;

	i32 r = (((srcPixel >> 16) & 0xFF) * tintR + 127) / 255;
	i32 g = (((srcPixel >> 8) & 0xFF) * tintG + 127) / 255;
	i32 b = ((srcPixel & 0xFF) * tintB + 127) / 255;
	i32 a = (srcA * tintA + 127) / 255;

	r = clampBlitByte(r);
	g = clampBlitByte(g);
	b = clampBlitByte(b);
	if (a <= 0) return false;
	a = clampBlitByte(a);

	if (applyDither) {
		ditherBlitRgb(r, g, b, ditherRow, x, ditherJitter, ditherIntensity);
	}

	if (a >= 255) {
		outPixel = 0xFF000000 |
					(static_cast<u32>(r) << 16) |
					(static_cast<u32>(g) << 8) |
					static_cast<u32>(b);
		return true;
	}

	outPixel = blendBlitRgb(dstPixel, r, g, b, a);
	return true;
}

template<bool EncodeSrgb>
static void readSoftwareTextureRegionPixels(const SoftwareTexture& texture, u8* out, i32 width, i32 height, i32 x, i32 y, const std::array<u8, 256>* lut) {
	const size_t rowStride = static_cast<size_t>(width) * 4u;
	for (i32 row = 0; row < height; ++row) {
		const size_t dstOffset = static_cast<size_t>(row) * rowStride;
		const size_t srcBase = static_cast<size_t>(y + row) * static_cast<size_t>(texture.width) + static_cast<size_t>(x);
		for (i32 col = 0; col < width; ++col) {
			const u32 pixel = texture.data[srcBase + static_cast<size_t>(col)];
			const u8 a = static_cast<u8>((pixel >> 24) & 0xffu);
			const u8 r = static_cast<u8>((pixel >> 16) & 0xffu);
			const u8 g = static_cast<u8>((pixel >> 8) & 0xffu);
			const u8 b = static_cast<u8>(pixel & 0xffu);
			const size_t outIndex = dstOffset + static_cast<size_t>(col) * 4u;
			if constexpr (EncodeSrgb) {
				out[outIndex + 0] = (*lut)[r];
				out[outIndex + 1] = (*lut)[g];
				out[outIndex + 2] = (*lut)[b];
			} else {
				out[outIndex + 0] = r;
				out[outIndex + 1] = g;
				out[outIndex + 2] = b;
			}
			out[outIndex + 3] = a;
		}
	}
}

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

void SoftwareBackend::setFramebuffer(u32* fb, i32 width, i32 height, i32 pitch) {
	m_framebuffer = fb;
	m_width = width;
	m_height = height;
	m_pitch = pitch;
	m_depthBuffer.resize(width * height, 1.0f);
}

TextureHandle SoftwareBackend::createTexture(const u8* data, i32 width, i32 height, const TextureParams& params) {
	auto tex = std::make_unique<SoftwareTexture>();
	tex->width = width;
	tex->height = height;
	tex->data.resize(width * height);

	std::vector<u8> linearized;
	const u8* uploadData = prepareUploadData(data, width, height, params, linearized);

	uploadRgba8ToSoftwareTexture(*tex, uploadData, width, height);

	SoftwareTexture* ptr = tex.get();
	m_textures.push_back(std::move(tex));
	return static_cast<TextureHandle>(ptr);
}

void SoftwareBackend::updateTexture(TextureHandle handle, const u8* data, i32 width, i32 height, const TextureParams& params) {
	auto* tex = static_cast<SoftwareTexture*>(handle);
	if (tex->width != width || tex->height != height) {
		tex->width = width;
		tex->height = height;
		tex->data.resize(static_cast<size_t>(width) * height);
	}
	std::vector<u8> linearized;
	const u8* uploadData = prepareUploadData(data, width, height, params, linearized);
	uploadRgba8ToSoftwareTexture(*tex, uploadData, width, height);
}

TextureHandle SoftwareBackend::resizeTexture(TextureHandle handle, i32 width, i32 height, const TextureParams& params) {
	(void)params;
	auto* tex = static_cast<SoftwareTexture*>(handle);
	if (tex->width != width || tex->height != height) {
		tex->width = width;
		tex->height = height;
		tex->data.resize(static_cast<size_t>(width) * height);
	}
	return handle;
}

void SoftwareBackend::updateTextureRegion(TextureHandle handle, const u8* data, i32 width, i32 height, i32 x, i32 y, const TextureParams& params) {
	auto* tex = static_cast<SoftwareTexture*>(handle);
	std::vector<u8> linearized;
	const u8* uploadData = prepareUploadData(data, width, height, params, linearized);
	for (i32 row = 0; row < height; ++row) {
		const size_t srcOffset = static_cast<size_t>(row) * static_cast<size_t>(width) * 4u;
		const size_t dstOffset = static_cast<size_t>(y + row) * static_cast<size_t>(tex->width) + static_cast<size_t>(x);
		for (i32 col = 0; col < width; ++col) {
			const size_t srcIndex = srcOffset + static_cast<size_t>(col) * 4u;
			tex->data[dstOffset + static_cast<size_t>(col)] = packRgba8AsArgb32(uploadData + srcIndex);
		}
	}
}

void SoftwareBackend::readTextureRegion(TextureHandle handle, u8* out, i32 width, i32 height, i32 x, i32 y, const TextureParams& params) {
	auto* tex = static_cast<SoftwareTexture*>(handle);
	const i32 texW = tex->width;
	const i32 texH = tex->height;
	if (x < 0 || y < 0 || x + width > texW || y + height > texH) {
		throw std::runtime_error("[SoftwareBackend] Readback out of bounds.");
	}
	if (params.srgb) {
		const auto& lut = linearToSrgbLut();
		readSoftwareTextureRegionPixels<true>(*tex, out, width, height, x, y, &lut);
		return;
	}
	readSoftwareTextureRegionPixels<false>(*tex, out, width, height, x, y, nullptr);
}

TextureHandle SoftwareBackend::createSolidTexture2D(i32 width, i32 height, u32 color, const TextureParams& params) {
	(void)params;
	auto tex = std::make_unique<SoftwareTexture>();
	tex->width = width;
	tex->height = height;
	tex->data.resize(width * height, color);

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

void SoftwareBackend::copyTextureRegion(TextureHandle source, TextureHandle destination, i32 srcX, i32 srcY, i32 dstX, i32 dstY, i32 width, i32 height) {
	auto* src = static_cast<SoftwareTexture*>(source);
	auto* dst = static_cast<SoftwareTexture*>(destination);
	for (i32 row = 0; row < height; ++row) {
		const auto* srcRow = src->data.data() + static_cast<size_t>(srcY + row) * static_cast<size_t>(src->width) + static_cast<size_t>(srcX);
		auto* dstRow = dst->data.data() + static_cast<size_t>(dstY + row) * static_cast<size_t>(dst->width) + static_cast<size_t>(dstX);
		std::memcpy(dstRow, srcRow, static_cast<size_t>(width) * sizeof(u32));
	}
}

void SoftwareBackend::clear(const std::array<f32, 4>* color, const f32* depth) {
	if (color && m_framebuffer) {
		const u32 packed = (static_cast<u32>((*color)[3] * 255.0f) << 24u)
			| (static_cast<u32>((*color)[0] * 255.0f) << 16u)
			| (static_cast<u32>((*color)[1] * 255.0f) << 8u)
			| static_cast<u32>((*color)[2] * 255.0f);
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

	const std::array<f32, 4>* clearColor = nullptr;
	if (colorSpec && colorSpec->clear) {
		clearColor = &*colorSpec->clear;
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

void SoftwareBackend::setPixel(i32 x, i32 y, u32 color) {
	if (x < 0 || x >= m_width || y < 0 || y >= m_height) return;
	if (!m_framebuffer) return;

	i32 pixelsPerRow = m_pitch / sizeof(u32);
	m_framebuffer[y * pixelsPerRow + x] = color;
}

void SoftwareBackend::blendPixel(i32 x, i32 y, u32 color) {
	if (x < 0 || x >= m_width || y < 0 || y >= m_height) return;
	if (!m_framebuffer) return;
	const SoftwareColorBytes bytes{
		static_cast<u8>((color >> 16u) & 0xffu),
		static_cast<u8>((color >> 8u) & 0xffu),
		static_cast<u8>(color & 0xffu),
		static_cast<u8>((color >> 24u) & 0xffu),
	};
	if (bytes.a == 0u) return;

	i32 pixelsPerRow = m_pitch / sizeof(u32);
	i32 idx = y * pixelsPerRow + x;

	if (bytes.a == 255u) {
		m_framebuffer[idx] = color;
		return;
	}

	blendSoftwareArgb(m_framebuffer[idx], bytes.r, bytes.g, bytes.b, bytes.a);
}

void SoftwareBackend::drawLine(i32 x0, i32 y0, i32 x1, i32 y1, u32 color) {
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

void SoftwareBackend::fillRect(i32 x, i32 y, i32 w, i32 h, u32 color) {
	// Clip to screen bounds
	i32 x0 = std::max(0, x);
	i32 y0 = std::max(0, y);
	i32 x1 = std::min(m_width, x + w);
	i32 y1 = std::min(m_height, y + h);

	if (x0 >= x1 || y0 >= y1) return;

	i32 pixelsPerRow = m_pitch / sizeof(u32);

	if (((color >> 24u) & 0xffu) == 255u) {
		for (i32 py = y0; py < y1; ++py) {
			u32* row = m_framebuffer + py * pixelsPerRow;
			for (i32 px = x0; px < x1; ++px) {
				row[px] = color;
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

void SoftwareBackend::drawRect(i32 x, i32 y, i32 w, i32 h, u32 color) {
	// Top and bottom edges
	drawLine(x, y, x + w - 1, y, color);
	drawLine(x, y + h - 1, x + w - 1, y + h - 1, color);
	// Left and right edges
	drawLine(x, y, x, y + h - 1, color);
	drawLine(x + w - 1, y, x + w - 1, y + h - 1, color);
}

void SoftwareBackend::blitTexture(TextureHandle tex, i32 srcX, i32 srcY, i32 srcW, i32 srcH,
									i32 dstX, i32 dstY, i32 dstW, i32 dstH, f32 depth,
									u32 tint, bool flipH, bool flipV,
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

	const SoftwareColorBytes tintBytes{
		static_cast<u8>((tint >> 16u) & 0xffu),
		static_cast<u8>((tint >> 8u) & 0xffu),
		static_cast<u8>(tint & 0xffu),
		static_cast<u8>((tint >> 24u) & 0xffu),
	};
	const i32 tintR = tintBytes.r;
	const i32 tintG = tintBytes.g;
	const i32 tintB = tintBytes.b;
	const i32 tintA = tintBytes.a;

	const u32* srcData = softTex->data.data();
	const i32 texWidth = softTex->width;

	i32 sy_fp = (srcY << 16) + baseY * stepY;

	// start repeated-sequence-acceptable -- Software blit is a per-pixel hot path; depth/no-depth loops stay direct instead of dispatching through a callback.
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

				u32 outPixel = 0;
				if (!shadeBlitPixel(srcRow[sx], dstRow[dx], tintR, tintG, tintB, tintA, applyDither, ditherRow, dx, ditherJitter, ditherIntensity, outPixel)) continue;
				dstRow[dx] = outPixel;

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

			u32 outPixel = 0;
			if (!shadeBlitPixel(srcRow[sx], dstRow[dx], tintR, tintG, tintB, tintA, applyDither, ditherRow, dx, ditherJitter, ditherIntensity, outPixel)) continue;
			dstRow[dx] = outPixel;
		}
		sy_fp += yStep;
	}
	// end repeated-sequence-acceptable
}

} // namespace bmsx
