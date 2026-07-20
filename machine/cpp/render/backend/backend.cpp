/*
 * backend.cpp - Software rendering backend implementation
 */

#include "backend.h"
#include "render/shared/software_pixels.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu.h"
#include "render/host_overlay/pass_registration.h"
#include "render/host_overlay/software/renderer.h"
#include "render/post/crt/software/pipeline.h"
#include "render/post/device_quantize/software/pipeline.h"
#include <array>
#include <algorithm>
#include <cmath>

namespace bmsx {

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

static u32 packLinearColorAsArgb32(const std::array<f32, 4>& color) {
	return (static_cast<u32>(color[3] * 255.0f) << 24u)
		| (static_cast<u32>(color[0] * 255.0f) << 16u)
		| (static_cast<u32>(color[1] * 255.0f) << 8u)
		| static_cast<u32>(color[2] * 255.0f);
}

static void uploadRgba8ToSoftwareTexture(SoftwareTexture& texture, const u8* data, i32 width, i32 height) {
	for (i32 i = 0; i < width * height; ++i) {
		texture.data[static_cast<size_t>(i)] = packRgba8AsArgb32(data + static_cast<size_t>(i) * 4u);
	}
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
	: m_default_framebuffer(framebuffer)
	, m_default_width(width)
	, m_default_height(height)
	, m_default_pitch(pitch)
	, m_framebuffer(framebuffer)
	, m_width(width)
	, m_height(height)
	, m_pitch(pitch) {
}

SoftwareBackend::~SoftwareBackend() = default;

void SoftwareBackend::registerBuiltinPasses(RenderPassLibrary& registry) {
	registerFrameResolvePass(registry);
	registerGxGpuPassSoftware(registry);
	DeviceQuantizePipeline::Software::registerPass(registry);
	CRTPipeline::registerCRTPostSoftwarePass(registry);
	registerHostOverlayBackendPasses<SoftwareBackend, beginHostOverlaySoftware, renderHost2DEntrySoftware, endHostOverlaySoftware>(registry);
}

void SoftwareBackend::applyFramebufferTarget(u32* fb, i32 width, i32 height, i32 pitch) {
	m_framebuffer = fb;
	m_width = width;
	m_height = height;
	m_pitch = pitch;
}

void SoftwareBackend::setFramebuffer(u32* fb, i32 width, i32 height, i32 pitch) {
	m_default_framebuffer = fb;
	m_default_width = width;
	m_default_height = height;
	m_default_pitch = pitch;
	applyFramebufferTarget(fb, width, height, pitch);
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

TextureHandle SoftwareBackend::createColorTexture(i32 width, i32 height, const std::array<f32, 4>* initialClearColor) {
	auto tex = std::make_unique<SoftwareTexture>();
	tex->width = width;
	tex->height = height;
	tex->data.resize(static_cast<size_t>(width) * static_cast<size_t>(height));
	if (initialClearColor != nullptr) {
		std::fill(tex->data.begin(), tex->data.end(), packLinearColorAsArgb32(*initialClearColor));
	}

	SoftwareTexture* ptr = tex.get();
	m_textures.push_back(std::move(tex));
	return static_cast<TextureHandle>(ptr);
}

struct SoftwareDepthTexture {
	i32 width = 0;
	i32 height = 0;
};

TextureHandle SoftwareBackend::createDepthTexture(i32 width, i32 height) {
	auto* depth = new SoftwareDepthTexture{};
	depth->width = width;
	depth->height = height;
	return static_cast<TextureHandle>(depth);
}

void SoftwareBackend::destroyDepthTexture(TextureHandle handle) {
	delete static_cast<SoftwareDepthTexture*>(handle);
}

void* SoftwareBackend::createRenderTarget(TextureHandle color, TextureHandle depth) {
	(void)depth;
	return color;
}

void SoftwareBackend::destroyRenderTarget(void* target) {
	(void)target;
}

void SoftwareBackend::activateRenderTarget(void* target, i32 width, i32 height) {
	auto* texture = static_cast<SoftwareTexture*>(target);
	applyFramebufferTarget(texture->data.data(), width, height, width * static_cast<i32>(sizeof(u32)));
}

void SoftwareBackend::activateDefaultRenderTarget() {
	if (m_framebuffer == m_default_framebuffer
		&& m_width == m_default_width
		&& m_height == m_default_height
		&& m_pitch == m_default_pitch) {
		return;
	}
	applyFramebufferTarget(m_default_framebuffer, m_default_width, m_default_height, m_default_pitch);
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

void SoftwareBackend::clear(const std::array<f32, 4>* color, const f32* depth) {
	if (color && m_framebuffer) {
		const u32 packed = packLinearColorAsArgb32(*color);
		i32 pixelsPerRow = m_pitch / sizeof(u32);
		for (i32 y = 0; y < m_height; ++y) {
			u32* row = m_framebuffer + y * pixelsPerRow;
			for (i32 x = 0; x < m_width; ++x) {
				row[x] = packed;
			}
		}
	}

	(void)depth;
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

void SoftwareBackend::presentTexture(TextureHandle texture) {
	const auto& source = *static_cast<SoftwareTexture*>(texture);
	const u32* const sourcePixels = source.data.data();
	const i32 targetPixelsPerRow = m_pitch / static_cast<i32>(sizeof(u32));
	if (source.width == m_width && source.height == m_height) {
		for (i32 y = 0; y < m_height; y += 1) {
			const u32* sourceRow = sourcePixels + static_cast<size_t>(y) * static_cast<size_t>(source.width);
			u32* targetRow = m_framebuffer + static_cast<size_t>(y) * static_cast<size_t>(targetPixelsPerRow);
			for (i32 x = 0; x < m_width; x += 1) {
				targetRow[x] = sourceRow[x] | 0xff000000u;
			}
		}
		return;
	}

	const u32 sourceStepX = (static_cast<u32>(source.width) << 16u) / static_cast<u32>(m_width);
	const u32 sourceStepY = (static_cast<u32>(source.height) << 16u) / static_cast<u32>(m_height);
	u32 sourceY = 0u;
	for (i32 y = 0; y < m_height; y += 1) {
		const u32* sourceRow = sourcePixels
			+ static_cast<size_t>(sourceY >> 16u) * static_cast<size_t>(source.width);
		u32* targetRow = m_framebuffer + static_cast<size_t>(y) * static_cast<size_t>(targetPixelsPerRow);
		u32 sourceX = 0u;
		for (i32 x = 0; x < m_width; x += 1) {
			targetRow[x] = sourceRow[sourceX >> 16u] | 0xff000000u;
			sourceX += sourceStepX;
		}
		sourceY += sourceStepY;
	}
}

} // namespace bmsx
