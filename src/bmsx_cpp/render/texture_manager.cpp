#include "texture_manager.h"
#include "render/backend/texture_params.h"
#include "render/backend/backend.h"
#include "common/types.h"
#include <iomanip>
#include <ios>
#include <sstream>
#include <string>
#include <utility>

namespace bmsx {
namespace {

auto textureParamsKey(const TextureParams& desc) -> std::string {
	std::ostringstream oss;
	oss << "size=" << std::fixed << std::setprecision(3)
		<< desc.size.x << "x" << desc.size.y
		<< "|srgb=" << (desc.srgb ? "1" : "0")
		<< "|wrapS=" << desc.wrapS
		<< "|wrapT=" << desc.wrapT
		<< "|minFilter=" << desc.minFilter
		<< "|magFilter=" << desc.magFilter;
	return oss.str();
}

} // namespace

TextureManager* TextureManager::s_instance = nullptr;

TextureManager::TextureManager(GPUBackend* backend)
	: m_backend(backend) {
	s_instance = this;
}

TextureManager::~TextureManager() {
	clear();
	if (s_instance == this) {
		s_instance = nullptr;
	}
}

auto TextureManager::instance() -> TextureManager& {
	return *s_instance;
}

void TextureManager::setBackend(GPUBackend* backend) {
	if (m_backend != backend) {
		clear();
	}
	m_backend = backend;
}

auto TextureManager::makeKey(const std::string& uri, const TextureParams& desc) const -> TextureKey {
	return uri + "|" + textureParamsKey(desc);
}

auto TextureManager::createTextureFromPixelsSync(const std::string& keyBase,
												const u8* pixels,
												i32 width,
												i32 height,
												const TextureParams& desc) -> TextureHandle {
	const TextureKey key = makeKey(keyBase, desc);
	auto it = m_gpuCache.find(key);
	if (it != m_gpuCache.end()) {
		return it->second.handle;
	}
	TextureHandle handle = m_backend->createTexture(pixels, width, height, desc);
	m_gpuCache.emplace(key, GPUCacheEntry{.handle=handle, .desc=desc});
	return handle;
}

auto TextureManager::resizeTextureForKey(const std::string& keyBase, i32 width, i32 height, const TextureParams& desc) -> TextureHandle {
	GPUCacheEntry& entry = m_gpuCache.at(makeKey(keyBase, desc));
	entry.handle = m_backend->resizeTexture(entry.handle, width, height, entry.desc);
	return entry.handle;
}

auto TextureManager::getTexture(const TextureKey& key) const -> TextureHandle {
	return m_gpuCache.at(key).handle;
}

auto TextureManager::getTextureByUri(const std::string& uri, const TextureParams& desc) const -> TextureHandle {
	return getTexture(makeKey(uri, desc));
}

void TextureManager::swapTextureHandlesByUri(const std::string& uriA, const std::string& uriB, const TextureParams& descA, const TextureParams& descB) {
	GPUCacheEntry& entryA = m_gpuCache.at(makeKey(uriA, descA));
	GPUCacheEntry& entryB = m_gpuCache.at(makeKey(uriB, descB));
	std::swap(entryA.handle, entryB.handle);
}

void TextureManager::clear() {
	for (auto& kv : m_gpuCache) {
		m_backend->destroyTexture(kv.second.handle);
	}
	m_gpuCache.clear();
}

} // namespace bmsx
