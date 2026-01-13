#include "texturemanager.h"
#include <algorithm>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <stdexcept>

// stb_image for buffer decoding
#include "../vendor/stb_image.h"

namespace bmsx {
namespace {

TaskGate& textureGate() {
	static TaskGate gate;
	return gate;
}

std::string textureParamsKey(const TextureParams& desc) {
	std::ostringstream oss;
	oss << "size=" << std::fixed << std::setprecision(3)
		<< desc.size.x << "x" << desc.size.y
		<< "|srgb=" << (desc.srgb ? "1" : "0");
	return oss.str();
}

TextureSource flippedCopy(const TextureSource& src) {
	if (!src.valid()) return {};
	const size_t rowBytes = static_cast<size_t>(src.width) * 4;
	std::vector<u8> out(static_cast<size_t>(src.width) * src.height * 4);
	for (i32 y = 0; y < src.height; ++y) {
		const u8* srcRow = src.pixels + (static_cast<size_t>(src.height - 1 - y) * rowBytes);
		u8* dstRow = out.data() + (static_cast<size_t>(y) * rowBytes);
		std::memcpy(dstRow, srcRow, rowBytes);
	}
	return TextureSource::fromOwned(std::move(out), src.width, src.height);
}

} // namespace

TextureManager* TextureManager::s_instance = nullptr;

TextureManager::TextureManager(GPUBackend* backend)
	: m_backend(backend),
	  m_group(textureGate().group("texture:default")),
	  m_textureBarrier(m_group) {
	s_instance = this;
}

TextureManager::~TextureManager() {
	dispose();
	if (s_instance == this) {
		s_instance = nullptr;
	}
}

TextureManager* TextureManager::instancePtr() {
	return s_instance;
}

TextureManager& TextureManager::instance() {
	if (!s_instance) {
		throw BMSX_RUNTIME_ERROR("TextureManager::instance() called before instance was created.");
	}
	return *s_instance;
}

const Identifier& TextureManager::registryId() const {
	static const Identifier id = "texmgr";
	return id;
}

void TextureManager::bind() {
	Registry::instance().registerObject(this);
}

void TextureManager::unbind() {
	Registry::instance().deregister(this, true);
}

void TextureManager::setBackend(GPUBackend* backend) {
	if (m_backend != backend) {
		m_textureBarrier.clear();
		m_gpuCache.clear();
		m_imageCache.clear();
	}
	m_backend = backend;
}

TextureKey TextureManager::makeKey(const std::string& uri, const TextureParams& desc) const {
	return uri + "|" + textureParamsKey(desc);
}

TextureKey TextureManager::makeModelBufferKey(const ModelTextureIdentifier& identifier) const {
	return "buf:" + identifier.modelName + ":" + std::to_string(identifier.modelImageIndex);
}

TextureKey TextureManager::acquireTexture(const TextureKey& key,
										  const std::function<TextureSource()>& loadBitmapFn,
										  const TextureParams& desc,
										  TextureHandle fallbackHandle) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}

	auto it = m_gpuCache.find(key);
	if (it != m_gpuCache.end()) {
		it->second.refCount++;
		return key;
	}

	GPUCacheEntry entry;
	entry.handle = fallbackHandle;
	entry.refCount = 1;
	entry.ownedFallback = false;
	entry.params = desc;
	m_gpuCache.emplace(key, entry);
	TextureHandle handle = m_textureBarrier.acquire(
		key,
		[this, &loadBitmapFn, &desc]() {
			TextureSource src = loadBitmapFn();
			return createTextureFromSource(src, desc);
		},
		BarrierAcquireOptions<TextureHandle>{
			{},
			false,
			"texture",
			"tex:" + key,
			[this](const TextureHandle& h) {
				if (m_backend) m_backend->destroyTexture(h);
			},
			1000
		}
	);

	auto entryIt = m_gpuCache.find(key);
	if (entryIt != m_gpuCache.end()) {
		entryIt->second.handle = handle;
	}

	return key;
}

TextureKey TextureManager::ensureTextureReady(const TextureKey& key,
											  const std::function<TextureSource()>& loadBitmapFn,
											  const TextureParams& desc) {
	return acquireTexture(key, loadBitmapFn, desc, nullptr);
}

TextureSource TextureManager::getImage(const ImageKey& key) const {
	auto it = m_imageCache.find(key);
	if (it == m_imageCache.end()) {
		return {};
	}
	return it->second.source;
}

TextureHandle TextureManager::getTexture(const TextureKey& key) const {
	auto it = m_gpuCache.find(key);
	return it != m_gpuCache.end() ? it->second.handle : nullptr;
}

TextureHandle TextureManager::getTextureByUri(const std::string& uri,
											  const TextureParams& desc) const {
	return getTexture(makeKey(uri, desc));
}

void TextureManager::releaseByUri(const std::string& uri, const TextureParams& desc) {
	releaseByKey(makeKey(uri, desc));
}

TextureHandle TextureManager::getOrCreateTexture(const TextureKey& key,
												 const u8* pixels,
												 i32 width,
												 i32 height,
												 const TextureParams& desc) {
	TextureSource src = TextureSource::fromView(pixels, width, height);
	ensureTextureReady(key, [src]() { return src; }, desc);
	return getTexture(key);
}

void TextureManager::updateTexture(TextureHandle handle,
								   const u8* pixels,
								   i32 width,
								   i32 height,
								   const TextureParams& desc) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}
	if (!handle) {
		throw BMSX_RUNTIME_ERROR("TextureManager: invalid texture handle");
	}
	m_backend->updateTexture(handle, pixels, width, height, desc);
}

void TextureManager::updateTexturesForAsset(const AssetId& assetId,
											const u8* pixels,
											i32 width,
											i32 height) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}
	if (assetId.empty()) {
		throw BMSX_RUNTIME_ERROR("TextureManager: asset id missing for texture update");
	}
	if (!pixels || width <= 0 || height <= 0) {
		throw BMSX_RUNTIME_ERROR("TextureManager: image asset missing pixel data");
	}
	const std::string prefix = assetId + "|";
	for (auto& [key, gpuEntry] : m_gpuCache) {
		if (key.rfind(prefix, 0) != 0) {
			continue;
		}
		if (!gpuEntry.handle) {
			continue;
		}
		m_backend->updateTexture(gpuEntry.handle,
								 pixels,
								 width,
								 height,
								 gpuEntry.params);
	}
}

TextureHandle TextureManager::replaceTexture(const TextureKey& key,
											 const u8* pixels,
											 i32 width,
											 i32 height,
											 const TextureParams& desc) {
	// Force remove existing texture regardless of refcount
	auto it = m_gpuCache.find(key);
	if (it != m_gpuCache.end()) {
		GPUCacheEntry& entry = it->second;
		m_textureBarrier.release(key, [this](const TextureHandle& h) {
			if (m_backend) m_backend->destroyTexture(h);
		});
		if (entry.ownedFallback && entry.handle && m_backend) {
			m_backend->destroyTexture(entry.handle);
		}
		m_gpuCache.erase(it);
	}
	// Create new texture with the new pixel data
	return getOrCreateTexture(key, pixels, width, height, desc);
}


TextureSource TextureManager::fromBuffer(const ImageKey& key,
										 const u8* buffer,
										 size_t size,
										 bool flipY) {
	auto it = m_imageCache.find(key);
	if (it != m_imageCache.end()) {
		it->second.refCount++;
		if (it->second.source.valid()) {
			return it->second.source;
		}
	}

	int width = 0;
	int height = 0;
	int channels = 0;
	u8* pixels = stbi_load_from_memory(buffer, static_cast<int>(size),
									   &width, &height, &channels, 4);
	if (!pixels) {
		throw BMSX_RUNTIME_ERROR("TextureManager: failed to decode image buffer");
	}

	std::vector<u8> out(static_cast<size_t>(width) * height * 4);
	std::memcpy(out.data(), pixels, out.size());
	stbi_image_free(pixels);

	TextureSource src = TextureSource::fromOwned(std::move(out), width, height);
	if (flipY) {
		src = flippedCopy(src);
	}

	ImageCacheEntry entry;
	entry.source = src;
	entry.refCount = 1;
	m_imageCache[key] = entry;
	return src;
}


TextureSource TextureManager::createSolid(i32 size, const Color& color) {
	const u8 r = static_cast<u8>(color.r * 255.0f);
	const u8 g = static_cast<u8>(color.g * 255.0f);
	const u8 b = static_cast<u8>(color.b * 255.0f);
	const u8 a = static_cast<u8>(color.a * 255.0f);
	std::vector<u8> pixels(static_cast<size_t>(size) * size * 4);
	for (size_t i = 0; i < pixels.size(); i += 4) {
		pixels[i + 0] = r;
		pixels[i + 1] = g;
		pixels[i + 2] = b;
		pixels[i + 3] = a;
	}
	return TextureSource::fromOwned(std::move(pixels), size, size);
}

TextureHandle TextureManager::createTextureFromSource(const TextureSource& source,
													  const TextureParams& desc) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}
	if (!source.valid()) {
		throw BMSX_RUNTIME_ERROR("TextureManager: invalid texture source");
	}
	return m_backend->createTexture(source.pixels, source.width, source.height, desc);
}

void TextureManager::releaseByKey(const TextureKey& key) {
	auto it = m_gpuCache.find(key);
	if (it == m_gpuCache.end()) return;

	GPUCacheEntry& entry = it->second;
	entry.refCount--;
	if (entry.refCount <= 0) {
		m_textureBarrier.release(key, [this](const TextureHandle& h) {
			if (m_backend) m_backend->destroyTexture(h);
		});
		if (entry.ownedFallback && entry.handle && m_backend) {
			m_backend->destroyTexture(entry.handle);
		}
		m_gpuCache.erase(it);
	}
}

void TextureManager::clear() {
	for (auto& kv : m_gpuCache) {
		auto& entry = kv.second;
		if (entry.ownedFallback && entry.handle && m_backend) {
			m_backend->destroyTexture(entry.handle);
		}
	}
	m_textureBarrier.clear([this](const TextureHandle& h) {
		if (m_backend) m_backend->destroyTexture(h);
	});
	m_gpuCache.clear();
	m_imageCache.clear();
}

void TextureManager::dispose() {
	clear();
	unbind();
}

} // namespace bmsx
