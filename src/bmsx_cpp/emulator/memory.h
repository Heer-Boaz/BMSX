#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "cpu.h"
#include "memory_map.h"
#include "io.h"
#include "../core/types.h"

namespace bmsx {

constexpr uint32_t ASSET_TABLE_HEADER_SIZE = 40;
constexpr uint32_t ASSET_TABLE_ENTRY_SIZE = 64;
constexpr uint32_t ASSET_FLAG_VIEW = 1u << 1;

class Memory {
public:
	class VramWriter {
	public:
		virtual ~VramWriter() = default;
		virtual void writeVram(uint32_t addr, const u8* data, size_t length) = 0;
	};
	class VdpIoHandler {
	public:
		virtual ~VdpIoHandler() = default;
		virtual uint32_t readVdpStatus() = 0;
		virtual uint32_t readVdpData() = 0;
	};
	class IoWriteHandler {
	public:
		virtual ~IoWriteHandler() = default;
		virtual void onIoWrite(uint32_t addr, Value value) = 0;
	};

	Memory();

	void setEngineRom(const u8* data, size_t size);
	void setCartRom(const u8* data, size_t size);
	void setOverlayRom(u8* data, size_t size);
	size_t overlayRomSize() const;
	void setVramWriter(VramWriter* writer);
	void setVdpIoHandler(VdpIoHandler* handler);
	void setIoWriteHandler(IoWriteHandler* handler);
	uint32_t usedAssetTableBytes() const;
	uint32_t usedAssetDataBytes() const;

	Value readValue(uint32_t addr) const;
	void writeValue(uint32_t addr, Value value);

	u8 readU8(uint32_t addr) const;
	void writeU8(uint32_t addr, u8 value);

	uint32_t readU32(uint32_t addr) const;
	void writeU32(uint32_t addr, uint32_t value);

	void writeBytes(uint32_t addr, const u8* data, size_t length);
	void readBytes(uint32_t addr, u8* out, size_t length) const;
	bool isVramRange(uint32_t addr, size_t length) const;

	enum class AssetType {
		Image,
		Audio,
	};

	struct AssetEntry {
		std::string id;
		uint64_t idToken = 0;
		AssetType type = AssetType::Image;
		uint32_t flags = 0;
		size_t ownerIndex = 0;
		uint32_t baseAddr = 0;
		uint32_t baseSize = 0;
		uint32_t capacity = 0;
		uint32_t baseStride = 0;
		uint32_t regionX = 0;
		uint32_t regionY = 0;
		uint32_t regionW = 0;
		uint32_t regionH = 0;
		uint32_t sampleRate = 0;
		uint32_t channels = 0;
		uint32_t frames = 0;
		uint32_t bitsPerSample = 0;
		uint32_t audioDataOffset = 0;
		uint32_t audioDataSize = 0;
	};

	struct ImageWriteEntry {
		uint32_t baseAddr = 0;
		uint32_t capacity = 0;
		uint32_t baseSize = 0;
		uint32_t baseStride = 0;
		uint32_t regionX = 0;
		uint32_t regionY = 0;
		uint32_t regionW = 0;
		uint32_t regionH = 0;
	};

	struct ImageWritePlan {
		uint32_t baseAddr = 0;
		uint32_t writeWidth = 0;
		uint32_t writeHeight = 0;
		uint32_t writeStride = 0;
		uint32_t targetStride = 0;
		uint32_t sourceStride = 0;
		size_t writeLen = 0;
		bool clipped = false;
	};

	void resetAssetMemory();
	AssetEntry& registerImageBuffer(const std::string& id, const u8* rgba, uint32_t width, uint32_t height, uint32_t flags);
	AssetEntry& registerImageSlot(const std::string& id, uint32_t capacityBytes, uint32_t flags);
	AssetEntry& registerImageSlotAt(const std::string& id, uint32_t baseAddr, uint32_t capacityBytes, uint32_t flags, bool clear = true);
	AssetEntry& registerImageView(const std::string& id, const AssetEntry& base, uint32_t regionX, uint32_t regionY, uint32_t regionW, uint32_t regionH, uint32_t flags);
	AssetEntry& registerAudioBuffer(
		const std::string& id,
		const u8* bytes,
		size_t byteCount,
		uint32_t sampleRate,
		uint32_t channels,
		uint32_t bitsPerSample,
		uint32_t frames,
		uint32_t dataOffset,
		uint32_t dataSize
	);
	AssetEntry& registerAudioMeta(
		const std::string& id,
		uint32_t sampleRate,
		uint32_t channels,
		uint32_t bitsPerSample,
		uint32_t frames,
		uint32_t dataOffset,
		uint32_t dataSize
	);
	bool hasAsset(const std::string& id) const;
	void sealEngineAssets();
	void resetCartAssets();
	ImageWritePlan planImageWrite(ImageWriteEntry& entry, size_t pixelBytes, uint32_t width, uint32_t height, uint32_t capacity);
	ImageWritePlan planImageSlotWrite(AssetEntry& entry, size_t pixelBytes, uint32_t width, uint32_t height, uint32_t capacity);
	void writeImageSlot(AssetEntry& entry, const u8* pixels, size_t pixelBytes, uint32_t width, uint32_t height, uint32_t capacity);
	void updateImageViewBase(AssetEntry& entry, const AssetEntry& base);
	void updateImageView(AssetEntry& entry, const AssetEntry& base, uint32_t regionX, uint32_t regionY, uint32_t regionW, uint32_t regionH, uint32_t flags = 0);
	void finalizeAssetTable();
	std::vector<AssetEntry*> consumeDirtyAssets();
	void markAllAssetsDirty();
	std::vector<u8> dumpAssetMemory() const;
	void restoreAssetMemory(const u8* data, size_t size);
	u32 resolveAssetHandle(const std::string& id) const;
	AssetEntry& getAssetEntry(const std::string& id);
	const AssetEntry& getAssetEntry(const std::string& id) const;
	AssetEntry& getAssetEntryByHandle(size_t handle);
	const AssetEntry& getAssetEntryByHandle(size_t handle) const;
	const u8* getImagePixels(const AssetEntry& entry) const;
	const u8* getAudioBytes(const AssetEntry& entry) const;
	const u8* getAudioData(const AssetEntry& entry) const;

	const std::vector<Value>& ioSlots() const { return m_ioSlots; }
	void loadIoSlots(const std::vector<Value>& slots);
	void clearIoSlots();

private:
	struct RomSpan {
		const u8* data = nullptr;
		size_t size = 0;
	};
	struct MutableRomSpan {
		u8* data = nullptr;
		size_t size = 0;
	};

	RomSpan m_engineRom;
	RomSpan m_cartRom;
	MutableRomSpan m_overlayRom;
	std::vector<u8> m_ram;
	std::vector<Value> m_ioSlots;
	VramWriter* m_vramWriter = nullptr;
	VdpIoHandler* m_vdpIoHandler = nullptr;
	IoWriteHandler* m_ioWriteHandler = nullptr;

	std::vector<AssetEntry> m_assetEntries;
	std::unordered_map<std::string, size_t> m_assetIndexById;
	std::unordered_map<uint64_t, size_t> m_assetIndexByToken;
	std::vector<int32_t> m_assetOwnerPages;
	std::vector<uint8_t> m_assetDirtyFlags;
	std::vector<size_t> m_assetDirtyList;
	uint32_t m_assetDataCursor = 0;
	size_t m_engineAssetEntryCount = 0;
	uint32_t m_engineAssetDataEnd = ASSET_DATA_BASE;
	uint32_t m_cartAssetDataBase = ASSET_DATA_BASE;
	bool m_assetTableFinalized = false;


	bool isIoAddress(uint32_t addr) const;
	size_t ioIndex(uint32_t addr) const;
	size_t ramOffset(uint32_t addr, size_t length) const;
	uint32_t readU32FromRegion(uint32_t addr) const;
	const u8* readRegion(uint32_t addr, size_t length, size_t& outOffset) const;
	u8* writeRegion(uint32_t addr, size_t length, size_t& outOffset);
	void mapAssetPages(size_t ownerIndex, uint32_t addr, uint32_t size);
	void markAssetDirty(uint32_t addr, uint32_t size);
	uint32_t allocateAssetData(uint32_t size, uint32_t alignment);
	size_t addAssetEntry(AssetEntry entry);
	void updateAssetEntryData(size_t index, const AssetEntry& entry);
};

} // namespace bmsx
