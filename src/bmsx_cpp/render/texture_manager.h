#pragma once

#include "render/texture_load_barrier.h"
#include "rompack/loader.h"
#include "common/registry.h"
#include "core/taskgate.h"
#include "backend/backend.h"
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

using TextureKey = std::string;
using ImageKey = std::string;

struct TextureSource {
	const u8* pixels = nullptr;
	i32 width = 0;
	i32 height = 0;
	std::shared_ptr<std::vector<u8>> ownedPixels;

	bool valid() const { return pixels && width > 0 && height > 0; }

	static TextureSource fromView(const u8* data, i32 w, i32 h) {
		TextureSource src;
		src.pixels = data;
		src.width = w;
		src.height = h;
		return src;
	}

	static TextureSource fromOwned(std::vector<u8> data, i32 w, i32 h) {
		TextureSource src;
		src.ownedPixels = std::make_shared<std::vector<u8>>(std::move(data));
		src.pixels = src.ownedPixels->data();
		src.width = w;
		src.height = h;
		return src;
	}
};

class TextureManager : public Registerable {
public:
	explicit TextureManager(GPUBackend* backend);
	~TextureManager() override;

	static TextureManager& instance();

	const Identifier& registryId() const override;
	bool isRegistryPersistent() const override { return true; }

	void setBackend(GPUBackend* backend);

	TextureKey makeKey(const std::string& uri, const TextureParams& desc) const;

	TextureKey acquireTexture(const TextureKey& key,
								const std::function<TextureSource()>& loadBitmapFn,
								const TextureParams& desc = {},
								TextureHandle fallbackHandle = nullptr);
	TextureSource getImage(const ImageKey& key) const;
	TextureHandle getTexture(const TextureKey& key) const;
	TextureHandle getTextureByUri(const std::string& uri, const TextureParams& desc = {}) const;
	void swapTextureHandlesByUri(const std::string& uriA, const std::string& uriB, const TextureParams& descA = {}, const TextureParams& descB = {});
	void copyTextureByUri(const std::string& sourceUri, const std::string& destinationUri, i32 width, i32 height, const TextureParams& sourceDesc = {}, const TextureParams& destinationDesc = {});
	void releaseByUri(const std::string& uri, const TextureParams& desc = {});

	TextureHandle createTextureFromPixelsSync(const std::string& keyBase,
												const u8* pixels,
												i32 width,
												i32 height,
												const TextureParams& desc = {});
	void updateTexture(TextureHandle handle,
						const u8* pixels,
						i32 width,
						i32 height,
						const TextureParams& desc = {});
	TextureHandle resizeTextureForKey(const std::string& keyBase, i32 width, i32 height);
	void updateTextureRegionForKey(const std::string& keyBase,
									const u8* pixels,
									i32 width,
									i32 height,
									i32 x,
									i32 y);


	TextureSource fromBuffer(const ImageKey& key,
								const u8* buffer,
								size_t size,
								bool flipY = false);
	TextureSource createSolid(i32 size, const Color& color);

	void releaseByKey(const TextureKey& key);
	void clear();
	void dispose();

private:
	struct ImageCacheEntry {
		TextureSource source;
		int refCount = 0;
	};

	struct GPUCacheEntry {
		TextureHandle handle = nullptr;
		int refCount = 0;
		bool ownedFallback = false;
		TextureParams params;
	};

	TextureKey ensureTextureReady(const TextureKey& key,
									const std::function<TextureSource()>& loadBitmapFn,
									const TextureParams& desc);

	GPUBackend* m_backend = nullptr;
	GateGroup m_group;
	TextureLoadBarrier<TextureHandle> m_textureBarrier;
	std::unordered_map<ImageKey, ImageCacheEntry> m_imageCache;
	std::unordered_map<TextureKey, GPUCacheEntry> m_gpuCache;

	static TextureManager* s_instance;
};

} // namespace bmsx
