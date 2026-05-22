#pragma once

#include "backend/backend.h"
#include <string>
#include <unordered_map>

namespace bmsx {

using TextureKey = std::string;

class TextureManager {
public:
	explicit TextureManager(GPUBackend* backend);
	~TextureManager();

	// Non-copyable and non-movable
	TextureManager(const TextureManager&) = delete;
	TextureManager& operator=(const TextureManager&) = delete;
	TextureManager(TextureManager&&) = delete;
	TextureManager& operator=(TextureManager&&) = delete;

	static auto instance() -> TextureManager&;

	void setBackend(GPUBackend* backend);
	auto makeKey(const std::string& uri, const TextureParams& desc = {}) const -> TextureKey;

	auto createTextureFromPixelsSync(const std::string& keyBase,
											const u8* pixels,
											i32 width,
											i32 height,
											const TextureParams& desc = {}) -> TextureHandle;
	auto resizeTextureForKey(const std::string& keyBase, i32 width, i32 height, const TextureParams& desc = {}) -> TextureHandle;
	auto getTexture(const TextureKey& key) const -> TextureHandle;
	auto getTextureByUri(const std::string& uri, const TextureParams& desc = {}) const -> TextureHandle;
	void swapTextureHandlesByUri(const std::string& uriA, const std::string& uriB, const TextureParams& descA = {}, const TextureParams& descB = {});
	void clear();

private:
	struct GPUCacheEntry {
		TextureHandle handle = nullptr;
		TextureParams desc;
	};

	GPUBackend* m_backend = nullptr;
	std::unordered_map<TextureKey, GPUCacheEntry> m_gpuCache;

	static TextureManager* s_instance;
};

} // namespace bmsx
