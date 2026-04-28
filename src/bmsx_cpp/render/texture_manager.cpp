#include "texture_manager.h"
#include "shared/solid_pixels.h"
#include <algorithm>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <stdexcept>

// stb_image for buffer decoding
#include "vendor/stb_image.h"

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
	if (it == m_gpuCache.end()) {
		return nullptr;
	}
	return it->second.handle;
}

TextureHandle TextureManager::getTextureByUri(const std::string& uri,
												const TextureParams& desc) const {
	return getTexture(makeKey(uri, desc));
}

void TextureManager::swapTextureHandlesByUri(const std::string& uriA, const std::string& uriB, const TextureParams& descA, const TextureParams& descB) {
	const TextureKey keyA = makeKey(uriA, descA);
	const TextureKey keyB = makeKey(uriB, descB);
	auto itA = m_gpuCache.find(keyA);
	if (itA == m_gpuCache.end() || !itA->second.handle) {
		throw BMSX_RUNTIME_ERROR("TextureManager: texture '" + uriA + "' is not initialized.");
	}
	auto itB = m_gpuCache.find(keyB);
	if (itB == m_gpuCache.end() || !itB->second.handle) {
		throw BMSX_RUNTIME_ERROR("TextureManager: texture '" + uriB + "' is not initialized.");
	}
	std::swap(itA->second.handle, itB->second.handle);
	std::swap(itA->second.ownedFallback, itB->second.ownedFallback);
}

void TextureManager::copyTextureByUri(const std::string& sourceUri, const std::string& destinationUri, i32 width, i32 height, const TextureParams& sourceDesc, const TextureParams& destinationDesc) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}
	const TextureKey sourceKey = makeKey(sourceUri, sourceDesc);
	const TextureKey destinationKey = makeKey(destinationUri, destinationDesc);
	auto sourceIt = m_gpuCache.find(sourceKey);
	if (sourceIt == m_gpuCache.end() || !sourceIt->second.handle) {
		throw BMSX_RUNTIME_ERROR("TextureManager: texture '" + sourceUri + "' is not initialized.");
	}
	auto destinationIt = m_gpuCache.find(destinationKey);
	if (destinationIt == m_gpuCache.end() || !destinationIt->second.handle) {
		throw BMSX_RUNTIME_ERROR("TextureManager: texture '" + destinationUri + "' is not initialized.");
	}
	m_backend->copyTexture(sourceIt->second.handle, destinationIt->second.handle, width, height);
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

void TextureManager::updateTexturesForImageId(const AssetId& imageId,
												const u8* pixels,
												i32 width,
												i32 height) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}
	if (imageId.empty()) {
		throw BMSX_RUNTIME_ERROR("TextureManager: image id missing for texture update");
	}
	if (!pixels || width <= 0 || height <= 0) {
		throw BMSX_RUNTIME_ERROR("TextureManager: image record missing pixel data");
	}
	const std::string prefix = imageId + "|";
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

TextureHandle TextureManager::resizeTextureForKey(const std::string& keyBase, i32 width, i32 height) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}
	if (keyBase.empty()) {
		throw BMSX_RUNTIME_ERROR("TextureManager: texture key missing for resize");
	}
	if (width <= 0 || height <= 0) {
		throw BMSX_RUNTIME_ERROR("TextureManager: invalid resize dimensions");
	}
	const std::string prefix = keyBase + "|";
	bool updated = false;
	TextureHandle updatedHandle = nullptr;
	for (auto& [key, gpuEntry] : m_gpuCache) {
		if (key.rfind(prefix, 0) != 0) {
			continue;
		}
		if (!gpuEntry.handle) {
			throw BMSX_RUNTIME_ERROR("TextureManager: texture handle missing for resize");
		}
		TextureHandle newHandle = m_backend->resizeTexture(gpuEntry.handle, width, height, gpuEntry.params);
		if (newHandle != gpuEntry.handle) {
			m_textureBarrier.replaceValue(key, newHandle, [this](const TextureHandle& h) {
				if (m_backend) m_backend->destroyTexture(h);
			});
			gpuEntry.handle = newHandle;
			gpuEntry.ownedFallback = false;
		}
		updated = true;
		updatedHandle = gpuEntry.handle;
	}
	if (!updated) {
		throw BMSX_RUNTIME_ERROR("TextureManager: texture not found for resize");
	}
	return updatedHandle;
}

void TextureManager::updateTextureRegionForKey(const std::string& keyBase,
												const u8* pixels,
												i32 width,
												i32 height,
												i32 x,
												i32 y) {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("TextureManager backend not set");
	}
	if (keyBase.empty()) {
		throw BMSX_RUNTIME_ERROR("TextureManager: texture key missing for region update");
	}
	if (!pixels || width <= 0 || height <= 0) {
		throw BMSX_RUNTIME_ERROR("TextureManager: region update missing pixel data");
	}
	const std::string prefix = keyBase + "|";
	for (auto& [key, gpuEntry] : m_gpuCache) {
		if (key.rfind(prefix, 0) != 0) {
			continue;
		}
		if (!gpuEntry.handle) {
			continue;
		}
		m_backend->updateTextureRegion(gpuEntry.handle,
										pixels,
										width,
										height,
										x,
										y,
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
	auto pixels = createSolidRgba8Pixels(size, size, color);
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
	Registry::instance().deregister(this, true);
}

} // namespace bmsx
