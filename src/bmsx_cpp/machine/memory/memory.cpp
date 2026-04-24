#include "machine/memory/memory.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/common/align.h"
#include "rompack/assets.h"
#include "common/byte_hex_string.h"
#include "common/endian.h"

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr uint32_t ASSET_TABLE_MAGIC = 0x32534D41u; // 'AMS2'
// 2 = FNV-1a 64 over exact UTF-8 bytes.
constexpr uint32_t ASSET_TABLE_HASH_ALG_ID = 2;
constexpr uint32_t ASSET_PAGE_SHIFT = 12;
constexpr uint32_t ASSET_PAGE_SIZE = 1u << ASSET_PAGE_SHIFT;
constexpr uint32_t ASSET_TYPE_IMAGE = 1;
constexpr uint32_t ASSET_TYPE_AUDIO = 2;

inline void writeU32LE(u8* dst, uint32_t value) {
	writeLE32(dst, value);
}

inline uint32_t readU32LE(const u8* src) {
	return readLE32(src);
}

bool rangeOverlaps(uint32_t addr, size_t length, uint32_t base, uint32_t size) {
	if (length == 0) {
		return false;
	}
	const uint32_t end = addr + static_cast<uint32_t>(length);
	const uint32_t baseEnd = base + size;
	return addr < baseEnd && end > base;
}

bool isVramRangeLocal(uint32_t addr, size_t length) {
	return rangeOverlaps(addr, length, VRAM_STAGING_BASE, VRAM_STAGING_SIZE)
		|| rangeOverlaps(addr, length, VRAM_SYSTEM_ATLAS_BASE, VRAM_SYSTEM_ATLAS_SIZE)
		|| rangeOverlaps(addr, length, VRAM_PRIMARY_ATLAS_BASE, VRAM_PRIMARY_ATLAS_SIZE)
		|| rangeOverlaps(addr, length, VRAM_SECONDARY_ATLAS_BASE, VRAM_SECONDARY_ATLAS_SIZE)
		|| rangeOverlaps(addr, length, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
}

template <typename Entry>
Memory::ImageWritePlan planImageWriteEntry(Entry& entry, size_t pixelBytes, uint32_t width, uint32_t height, uint32_t capacityOverride) {
	const uint32_t capacity = std::min(entry.capacity, capacityOverride);
	const uint32_t sourceWidth = width;
	const uint32_t sourceHeight = height;
	const uint32_t sourceStride = sourceWidth * 4u;
	const uint32_t maxPixels = capacity / 4u;
	uint32_t writeWidth = sourceWidth;
	uint32_t writeHeight = sourceHeight;
	if (sourceStride == 0 || sourceHeight == 0 || maxPixels == 0) {
		writeWidth = 0;
		writeHeight = 0;
	} else if (sourceWidth > maxPixels) {
		const uint32_t maxRowsByPixels = static_cast<uint32_t>(pixelBytes / sourceStride);
		writeWidth = std::min(sourceWidth, maxPixels);
		writeHeight = std::min<uint32_t>(1, maxRowsByPixels);
	} else {
		const uint32_t maxRowsByCapacity = capacity / sourceStride;
		const uint32_t maxRowsByPixels = static_cast<uint32_t>(pixelBytes / sourceStride);
		writeHeight = std::min({sourceHeight, maxRowsByCapacity, maxRowsByPixels});
	}
	const uint32_t writeStride = writeWidth * 4u;
	const uint32_t size = writeStride * writeHeight;
	const size_t writeLen = std::min(static_cast<size_t>(size), static_cast<size_t>(capacity));
	entry.baseSize = size;
	entry.baseStride = writeStride;
	entry.regionX = 0;
	entry.regionY = 0;
	entry.regionW = writeWidth;
	entry.regionH = writeHeight;
	Memory::ImageWritePlan plan;
	plan.baseAddr = entry.baseAddr;
	plan.writeWidth = writeWidth;
	plan.writeHeight = writeHeight;
	plan.writeStride = writeStride;
	plan.targetStride = writeStride;
	plan.sourceStride = sourceStride;
	plan.writeLen = writeLen;
	plan.clipped = (writeWidth != sourceWidth) || (writeHeight != sourceHeight);
	return plan;
}

Memory::AssetEntry makeAudioAssetEntry(
	const std::string& id,
	uint32_t baseAddr,
	uint32_t baseSize,
	uint32_t capacity,
	uint32_t sampleRate,
	uint32_t channels,
	uint32_t bitsPerSample,
	uint32_t frames,
	uint32_t dataOffset,
	uint32_t dataSize
) {
	Memory::AssetEntry entry;
	entry.id = id;
	entry.type = Memory::AssetType::Audio;
	entry.baseAddr = baseAddr;
	entry.baseSize = baseSize;
	entry.capacity = capacity;
	entry.sampleRate = sampleRate;
	entry.channels = channels;
	entry.frames = frames;
	entry.bitsPerSample = bitsPerSample;
	entry.audioDataOffset = dataOffset;
	entry.audioDataSize = dataSize;
	return entry;
}

}

Memory::Memory()
	: m_ram(RAM_USED_END - RAM_BASE)
	, m_ioSlots(IO_SLOT_COUNT, valueNil())
	, m_ioReadHandlers(IO_SLOT_COUNT)
	, m_ioWriteHandlers(IO_SLOT_COUNT) {
	const size_t pageCount = (ASSET_DATA_END - ASSET_DATA_BASE + ASSET_PAGE_SIZE - 1) / ASSET_PAGE_SIZE;
	m_assetOwnerPages.assign(pageCount, -1);
	resetAssetMemory();
}

void Memory::setEngineRom(const u8* data, size_t size) {
	if (size == 0) {
		m_engineRom = {};
		return;
	}
	m_engineRom = { data, size };
}

void Memory::setCartRom(const u8* data, size_t size) {
	if (size == 0) {
		m_cartRom = {};
		return;
	}
	m_cartRom = { data, size };
}

void Memory::setOverlayRom(u8* data, size_t size) {
	if (size == 0) {
		m_overlayRom = {};
		return;
	}
	m_overlayRom = { data, size };
}

size_t Memory::overlayRomSize() const {
	return m_overlayRom.size;
}

void Memory::setVramWriter(VramWriter* writer) {
	m_vramWriter = writer;
}

void Memory::mapIoRead(uint32_t addr, void* context, IoReadHandler handler) {
	m_ioReadHandlers[ioIndex(addr)] = { context, handler };
}

void Memory::mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler) {
	m_ioWriteHandlers[ioIndex(addr)] = { context, handler };
}

uint32_t Memory::usedAssetTableBytes() const {
	const size_t headerOffset = static_cast<size_t>(ASSET_TABLE_BASE - RAM_BASE);
	const uint8_t* base = m_ram.data();
	const uint32_t entryCount = readU32LE(base + headerOffset + 12);
	const uint32_t stringTableLength = readU32LE(base + headerOffset + 20);
	return ASSET_TABLE_HEADER_SIZE + (entryCount * ASSET_TABLE_ENTRY_SIZE) + stringTableLength;
}

uint32_t Memory::usedAssetDataBytes() const {
	const size_t headerOffset = static_cast<size_t>(ASSET_TABLE_BASE - RAM_BASE);
	const uint8_t* base = m_ram.data();
	return readU32LE(base + headerOffset + 28);
}

void Memory::resetAssetMemory() {
	const uint32_t previousDataCursor = m_assetDataCursor;
	if (previousDataCursor > ASSET_TABLE_BASE) {
		const uint32_t clearEnd = std::min(previousDataCursor, ASSET_DATA_ALLOC_END);
		const size_t clearOffset = static_cast<size_t>(ASSET_TABLE_BASE - RAM_BASE);
		const size_t clearSize = static_cast<size_t>(clearEnd - ASSET_TABLE_BASE);
		std::memset(m_ram.data() + clearOffset, 0, clearSize);
	}
	m_assetEntries.clear();
	m_assetIndexById.clear();
	m_assetIndexByToken.clear();
	m_assetDirtyFlags.clear();
	m_assetDirtyList.clear();
	m_assetTableFinalized = false;
	m_engineAssetEntryCount = 0;
	m_engineAssetDataEnd = ASSET_DATA_BASE;
	m_cartAssetDataBase = ASSET_DATA_BASE;
	std::fill(m_assetOwnerPages.begin(), m_assetOwnerPages.end(), -1);
	m_assetDataCursor = ASSET_DATA_BASE;
}

bool Memory::hasAsset(const std::string& id) const {
	if (m_assetIndexById.find(id) != m_assetIndexById.end()) {
		return true;
	}
	const uint64_t token = hashAssetToken(id);
	return m_assetIndexByToken.find(token) != m_assetIndexByToken.end();
}

void Memory::sealEngineAssets() {
	m_engineAssetEntryCount = m_assetEntries.size();
	m_engineAssetDataEnd = m_assetDataCursor;
	const uint32_t mask = ASSET_PAGE_SIZE - 1u;
	const uint32_t aligned = (m_engineAssetDataEnd + mask) & ~mask;
	if (aligned > ASSET_DATA_ALLOC_END) {
		throw std::runtime_error("[Memory] Engine data exceeds reserved RAM range.");
	}
	m_cartAssetDataBase = aligned;
}

void Memory::resetCartAssets() {
	const uint32_t previousDataCursor = m_assetDataCursor;
	m_assetEntries.resize(m_engineAssetEntryCount);
	m_assetIndexById.clear();
	m_assetIndexByToken.clear();
	m_assetDirtyFlags.clear();
	m_assetDirtyList.clear();
	m_assetTableFinalized = false;
	std::fill(m_assetOwnerPages.begin(), m_assetOwnerPages.end(), -1);
	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		auto& entry = m_assetEntries[index];
		m_assetIndexById[entry.id] = index;
		m_assetIndexByToken[entry.idToken] = index;
		m_assetDirtyFlags.push_back(0);
	}
	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		const auto& entry = m_assetEntries[index];
		if (entry.ownerIndex != index) {
			continue;
		}
		if (isVramRange(entry.baseAddr, entry.capacity)) {
			continue;
		}
		mapAssetPages(index, entry.baseAddr, entry.capacity);
	}
	m_assetDataCursor = m_cartAssetDataBase;
	if (previousDataCursor > m_cartAssetDataBase) {
		const uint32_t clearEnd = std::min(previousDataCursor, ASSET_DATA_ALLOC_END);
		const size_t cartOffset = static_cast<size_t>(m_cartAssetDataBase - RAM_BASE);
		const size_t clearSize = static_cast<size_t>(clearEnd - m_cartAssetDataBase);
		std::memset(m_ram.data() + cartOffset, 0, clearSize);
	}
}

Memory::AssetEntry& Memory::registerImageBuffer(const std::string& id, const u8* rgba, uint32_t width, uint32_t height, uint32_t flags) {
	const uint32_t stride = width * 4u;
	const uint32_t size = stride * height;
	const uint32_t addr = allocateAssetData(size, 4);
	const size_t offset = static_cast<size_t>(addr - RAM_BASE);
	std::memcpy(m_ram.data() + offset, rgba, size);
	AssetEntry entry;
	entry.id = id;
	entry.type = AssetType::Image;
	entry.flags = flags;
	entry.baseAddr = addr;
	entry.baseSize = size;
	entry.capacity = size;
	entry.baseStride = stride;
	entry.regionW = width;
	entry.regionH = height;
	return addOwnedAssetEntry(std::move(entry), addr, size);
}

Memory::AssetEntry& Memory::registerImageSlot(const std::string& id, uint32_t capacityBytes, uint32_t flags) {
	const uint32_t addr = allocateAssetData(capacityBytes, 4);
	const size_t offset = static_cast<size_t>(addr - RAM_BASE);
	std::memset(m_ram.data() + offset, 0, capacityBytes);
	AssetEntry entry;
	entry.id = id;
	entry.type = AssetType::Image;
	entry.flags = flags;
	entry.baseAddr = addr;
	entry.baseSize = 0;
	entry.capacity = capacityBytes;
	entry.baseStride = 0;
	entry.regionX = 0;
	entry.regionY = 0;
	entry.regionW = 0;
	entry.regionH = 0;
	return addOwnedAssetEntry(std::move(entry), addr, capacityBytes);
}

Memory::AssetEntry& Memory::registerImageSlotAt(const std::string& id, uint32_t baseAddr, uint32_t capacityBytes, uint32_t flags, bool clear) {
	const bool isVramSlot = isVramRange(baseAddr, capacityBytes);
	if (!isVramSlot) {
		if (baseAddr < RAM_BASE || baseAddr + capacityBytes > RAM_USED_END) {
			throw std::runtime_error("[Memory] Image slot out of RAM bounds.");
		}
		const size_t offset = static_cast<size_t>(baseAddr - RAM_BASE);
		if (clear) {
			std::memset(m_ram.data() + offset, 0, capacityBytes);
		}
	}
	AssetEntry entry;
	entry.id = id;
	entry.type = AssetType::Image;
	entry.flags = flags;
	entry.baseAddr = baseAddr;
	entry.baseSize = 0;
	entry.capacity = capacityBytes;
	entry.baseStride = 0;
	entry.regionW = 0;
	entry.regionH = 0;
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = index;
	if (!isVramSlot) {
		mapAssetPages(index, baseAddr, capacityBytes);
	}
	return m_assetEntries[index];
}

Memory::AssetEntry& Memory::registerImageView(const std::string& id, const AssetEntry& base, uint32_t regionX, uint32_t regionY, uint32_t regionW, uint32_t regionH, uint32_t flags) {
	const size_t ownerIndex = base.ownerIndex;
	AssetEntry entry;
	entry.id = id;
	entry.type = AssetType::Image;
	entry.flags = flags | ASSET_FLAG_VIEW;
	entry.ownerIndex = ownerIndex;
	entry.baseAddr = base.baseAddr;
	entry.baseSize = base.baseSize;
	entry.capacity = 0;
	entry.baseStride = base.baseStride;
	entry.regionX = regionX;
	entry.regionY = regionY;
	entry.regionW = regionW;
	entry.regionH = regionH;
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = ownerIndex;
	return m_assetEntries[index];
}

Memory::AssetEntry& Memory::registerAudioBuffer(
	const std::string& id,
	const u8* bytes,
	size_t byteCount,
	uint32_t sampleRate,
	uint32_t channels,
	uint32_t bitsPerSample,
	uint32_t frames,
	uint32_t dataOffset,
	uint32_t dataSize
) {
	const uint32_t size = static_cast<uint32_t>(byteCount);
	const uint32_t addr = allocateAssetData(size, 2);
	const size_t offset = static_cast<size_t>(addr - RAM_BASE);
	std::memcpy(m_ram.data() + offset, bytes, size);
	AssetEntry entry = makeAudioAssetEntry(id, addr, size, size, sampleRate, channels, bitsPerSample, frames, dataOffset, dataSize);
	return addOwnedAssetEntry(std::move(entry), addr, size);
}

Memory::AssetEntry& Memory::registerAudioMeta(
	const std::string& id,
	uint32_t sampleRate,
	uint32_t channels,
	uint32_t bitsPerSample,
	uint32_t frames,
	uint32_t dataOffset,
	uint32_t dataSize
) {
	AssetEntry entry = makeAudioAssetEntry(id, 0, 0, 0, sampleRate, channels, bitsPerSample, frames, dataOffset, dataSize);
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = index;
	return m_assetEntries[index];
}

void Memory::finalizeAssetTable() {
	const size_t entryCount = m_assetEntries.size();
	const uint32_t entryBaseAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE;
	const uint32_t entriesSize = static_cast<uint32_t>(entryCount * ASSET_TABLE_ENTRY_SIZE);
	std::unordered_map<std::string, uint32_t> stringOffsets;
	std::vector<u8> stringTable;
	stringTable.reserve(entryCount * 16u);
	for (const auto& entry : m_assetEntries) {
		if (stringOffsets.count(entry.id) != 0) {
			continue;
		}
		const uint32_t offset = static_cast<uint32_t>(stringTable.size());
		stringOffsets[entry.id] = offset;
		stringTable.insert(stringTable.end(), entry.id.begin(), entry.id.end());
		stringTable.push_back(0);
	}
	const uint32_t stringTableAddr = entryBaseAddr + entriesSize;
	const uint32_t tableEnd = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
	if (stringTableAddr + stringTable.size() > tableEnd) {
		throw std::runtime_error("[Memory] Asset table overflow.");
	}

	u8* base = m_ram.data();
	const uint32_t headerOffset = ASSET_TABLE_BASE - RAM_BASE;
	writeU32LE(base + headerOffset + 0, ASSET_TABLE_MAGIC);
	writeU32LE(base + headerOffset + 4, ASSET_TABLE_HEADER_SIZE);
	writeU32LE(base + headerOffset + 8, ASSET_TABLE_ENTRY_SIZE);
	writeU32LE(base + headerOffset + 12, static_cast<uint32_t>(entryCount));
	writeU32LE(base + headerOffset + 16, stringTableAddr);
	writeU32LE(base + headerOffset + 20, static_cast<uint32_t>(stringTable.size()));
	writeU32LE(base + headerOffset + 24, ASSET_DATA_BASE);
	writeU32LE(base + headerOffset + 28, m_assetDataCursor - ASSET_DATA_BASE);
	writeU32LE(base + headerOffset + 32, ASSET_TABLE_HASH_ALG_ID);
	writeU32LE(base + headerOffset + 36, 0u);

	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		const auto& entry = m_assetEntries[index];
		const uint32_t entryAddr = entryBaseAddr + static_cast<uint32_t>(index * ASSET_TABLE_ENTRY_SIZE);
		const uint32_t entryOffset = entryAddr - RAM_BASE;
		uint32_t typeId = 0;
		switch (entry.type) {
			case AssetType::Image:
				typeId = ASSET_TYPE_IMAGE;
				break;
			case AssetType::Audio:
				typeId = ASSET_TYPE_AUDIO;
				break;
			default:
				throw std::runtime_error("[Memory] Asset entry has unknown type.");
		}
		const uint32_t idAddr = stringTableAddr + stringOffsets.at(entry.id);
		const uint32_t tokenLo = static_cast<uint32_t>(entry.idToken & 0xffffffffu);
		const uint32_t tokenHi = static_cast<uint32_t>((entry.idToken >> 32) & 0xffffffffu);
		writeU32LE(base + entryOffset + 0, typeId);
		writeU32LE(base + entryOffset + 4, entry.flags);
		writeU32LE(base + entryOffset + 8, tokenLo);
		writeU32LE(base + entryOffset + 12, tokenHi);
		writeU32LE(base + entryOffset + 16, idAddr);
		writeAssetEntryMutableData(base, entryOffset, entry);
	}

	const uint32_t stringOffset = stringTableAddr - RAM_BASE;
	std::memcpy(base + stringOffset, stringTable.data(), stringTable.size());
	m_assetTableFinalized = true;
	enforceLuaHeapBudget();
}

std::vector<Memory::AssetEntry*> Memory::consumeDirtyAssets() {
	std::vector<AssetEntry*> entries;
	entries.reserve(m_assetDirtyList.size());
	for (const size_t index : m_assetDirtyList) {
		entries.push_back(&m_assetEntries[index]);
		m_assetDirtyFlags[index] = 0;
	}
	m_assetDirtyList.clear();
	return entries;
}

void Memory::markAllAssetsDirty() {
	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		if (m_assetEntries[index].ownerIndex != index) {
			continue;
		}
		if (isVramRange(m_assetEntries[index].baseAddr, m_assetEntries[index].capacity)) {
			continue;
		}
		if (m_assetDirtyFlags[index] == 0) {
			m_assetDirtyFlags[index] = 1;
			m_assetDirtyList.push_back(index);
		}
	}
}

std::vector<u8> Memory::dumpAssetMemory() const {
	std::vector<u8> snapshot(ASSET_RAM_SIZE);
	const size_t offset = static_cast<size_t>(ASSET_RAM_BASE - RAM_BASE);
	std::memcpy(snapshot.data(), m_ram.data() + offset, snapshot.size());
	return snapshot;
}

void Memory::restoreAssetMemory(const u8* data, size_t size) {
	if (size != ASSET_RAM_SIZE) {
		throw std::runtime_error("[Memory] RAM snapshot length mismatch.");
	}
	const size_t offset = static_cast<size_t>(ASSET_RAM_BASE - RAM_BASE);
	std::memcpy(m_ram.data() + offset, data, size);
	rehydrateAssetEntriesFromTable();
	markAllAssetsDirty();
}

std::vector<u8> Memory::dumpMutableRam() const {
	return m_ram;
}

void Memory::restoreMutableRam(const u8* data, size_t size) {
	if (size != m_ram.size()) {
		throw std::runtime_error("[Memory] RAM snapshot length mismatch.");
	}
	std::memcpy(m_ram.data(), data, size);
	rehydrateAssetEntriesFromTable();
	markAllAssetsDirty();
}

void Memory::rehydrateAssetEntriesFromTable() {
	const size_t headerOffset = static_cast<size_t>(ASSET_TABLE_BASE - RAM_BASE);
	const u8* base = m_ram.data();
	const uint32_t magic = readU32LE(base + headerOffset + 0);
	if (magic != ASSET_TABLE_MAGIC) {
		throw std::runtime_error("[Memory] Asset table magic mismatch.");
	}
	const uint32_t headerSize = readU32LE(base + headerOffset + 4);
	if (headerSize != ASSET_TABLE_HEADER_SIZE) {
		throw std::runtime_error("[Memory] Asset table header size mismatch.");
	}
	const uint32_t entrySize = readU32LE(base + headerOffset + 8);
	if (entrySize != ASSET_TABLE_ENTRY_SIZE) {
		throw std::runtime_error("[Memory] Asset table entry size mismatch.");
	}
	const uint32_t entryCount = readU32LE(base + headerOffset + 12);
	const uint32_t stringTableAddr = readU32LE(base + headerOffset + 16);
	const uint32_t stringTableLength = readU32LE(base + headerOffset + 20);
	const uint32_t dataBase = readU32LE(base + headerOffset + 24);
	const uint32_t dataLength = readU32LE(base + headerOffset + 28);
	const uint32_t hashAlgId = readU32LE(base + headerOffset + 32);
	if (dataBase != ASSET_DATA_BASE) {
		throw std::runtime_error("[Memory] Asset table data base mismatch.");
	}
	if (hashAlgId != ASSET_TABLE_HASH_ALG_ID) {
		throw std::runtime_error("[Memory] Asset table hash algorithm mismatch.");
	}

	const uint32_t stringTableOffset = stringTableAddr - RAM_BASE;
	const uint32_t stringTableEnd = stringTableOffset + stringTableLength;
	auto readString = [&](uint32_t addr) -> std::string {
		const uint32_t offset = addr - RAM_BASE;
		if (offset < stringTableOffset || offset >= stringTableEnd) {
			throw std::runtime_error("[Memory] Asset string pointer out of range.");
		}
		uint32_t cursor = offset;
		while (cursor < stringTableEnd && base[cursor] != 0u) {
			cursor += 1;
		}
		if (cursor >= stringTableEnd) {
			throw std::runtime_error("[Memory] Asset string missing terminator.");
		}
		return std::string(reinterpret_cast<const char*>(base + offset), cursor - offset);
	};

	m_assetEntries.assign(entryCount, AssetEntry{});
	m_assetIndexById.clear();
	m_assetIndexByToken.clear();
	m_assetDirtyFlags.assign(entryCount, 0u);
	m_assetDirtyList.clear();

	for (uint32_t index = 0; index < entryCount; ++index) {
		const uint32_t entryOffset = static_cast<uint32_t>(headerOffset + ASSET_TABLE_HEADER_SIZE + index * ASSET_TABLE_ENTRY_SIZE);
		const uint32_t typeId = readU32LE(base + entryOffset + 0);
		const uint32_t flags = readU32LE(base + entryOffset + 4);
		const uint32_t tokenLo = readU32LE(base + entryOffset + 8);
		const uint32_t tokenHi = readU32LE(base + entryOffset + 12);
		const uint32_t idAddr = readU32LE(base + entryOffset + 16);
		AssetEntry& entry = m_assetEntries[index];
		switch (typeId) {
			case ASSET_TYPE_IMAGE:
				entry.type = AssetType::Image;
				break;
			case ASSET_TYPE_AUDIO:
				entry.type = AssetType::Audio;
				break;
			default:
				throw std::runtime_error("[Memory] Asset entry has unknown type.");
		}
		entry.id = readString(idAddr);
		entry.idToken = static_cast<uint64_t>(tokenLo) | (static_cast<uint64_t>(tokenHi) << 32);
		entry.flags = flags;
		entry.baseAddr = readU32LE(base + entryOffset + 20);
		entry.baseSize = readU32LE(base + entryOffset + 24);
		entry.capacity = readU32LE(base + entryOffset + 28);
		entry.baseStride = 0;
		entry.regionX = 0;
		entry.regionY = 0;
		entry.regionW = 0;
		entry.regionH = 0;
		entry.sampleRate = 0;
		entry.channels = 0;
		entry.frames = 0;
		entry.bitsPerSample = 0;
		entry.audioDataOffset = 0;
		entry.audioDataSize = 0;
		switch (entry.type) {
			case AssetType::Image:
				entry.baseStride = readU32LE(base + entryOffset + 32);
				entry.regionX = readU32LE(base + entryOffset + 36);
				entry.regionY = readU32LE(base + entryOffset + 40);
				entry.regionW = readU32LE(base + entryOffset + 44);
				entry.regionH = readU32LE(base + entryOffset + 48);
				break;
			case AssetType::Audio:
				entry.sampleRate = readU32LE(base + entryOffset + 32);
				entry.channels = readU32LE(base + entryOffset + 36);
				entry.frames = readU32LE(base + entryOffset + 40);
				entry.bitsPerSample = readU32LE(base + entryOffset + 44);
				entry.audioDataOffset = readU32LE(base + entryOffset + 48);
				entry.audioDataSize = readU32LE(base + entryOffset + 52);
				break;
		}
		const AssetToken expectedToken = hashAssetToken(entry.id);
		if (expectedToken != entry.idToken) {
			throw std::runtime_error("[Memory] Asset token mismatch for '" + entry.id + "'.");
		}
		if (m_assetIndexById.find(entry.id) != m_assetIndexById.end()) {
			throw std::runtime_error("[Memory] Duplicate asset id in asset table.");
		}
		if (m_assetIndexByToken.find(entry.idToken) != m_assetIndexByToken.end()) {
			throw std::runtime_error("[Memory] Duplicate asset token in asset table.");
		}
		m_assetIndexById[entry.id] = index;
		m_assetIndexByToken[entry.idToken] = index;
	}

	std::unordered_map<uint32_t, size_t> ownerByBaseAddr;
	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		auto& entry = m_assetEntries[index];
		if ((entry.flags & ASSET_FLAG_VIEW) != 0u) {
			continue;
		}
		entry.ownerIndex = index;
		ownerByBaseAddr[entry.baseAddr] = index;
	}
	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		auto& entry = m_assetEntries[index];
		if ((entry.flags & ASSET_FLAG_VIEW) == 0u) {
			continue;
		}
		const auto owner = ownerByBaseAddr.find(entry.baseAddr);
		if (owner == ownerByBaseAddr.end()) {
			throw std::runtime_error("[Memory] Missing owner for asset view '" + entry.id + "'.");
		}
		entry.ownerIndex = owner->second;
	}

	std::fill(m_assetOwnerPages.begin(), m_assetOwnerPages.end(), -1);
	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		const auto& entry = m_assetEntries[index];
		if (entry.ownerIndex != index) {
			continue;
		}
		if (entry.capacity == 0 || isVramRange(entry.baseAddr, entry.capacity)) {
			continue;
		}
		mapAssetPages(index, entry.baseAddr, entry.capacity);
	}
	m_assetDataCursor = dataBase + dataLength;
	m_assetTableFinalized = true;
}

MemoryState Memory::captureState() const {
	MemoryState state;
	state.ioMemory = m_ioSlots;
	state.assetMemory = dumpAssetMemory();
	return state;
}

void Memory::restoreState(const MemoryState& state) {
	loadIoSlots(state.ioMemory);
	restoreAssetMemory(state.assetMemory.data(), state.assetMemory.size());
}

MemorySaveState Memory::captureSaveState() const {
	MemorySaveState state;
	state.ram = dumpMutableRam();
	return state;
}

void Memory::restoreSaveState(const MemorySaveState& state) {
	restoreMutableRam(state.ram.data(), state.ram.size());
}

u32 Memory::resolveAssetHandle(const std::string& id) const {
	const auto direct = m_assetIndexById.find(id);
	if (direct != m_assetIndexById.end()) {
		return static_cast<u32>(direct->second);
	}
	const uint64_t token = hashAssetToken(id);
	const auto hashed = m_assetIndexByToken.find(token);
	if (hashed == m_assetIndexByToken.end()) {
		throw std::runtime_error("[Memory] Asset '" + id + "' not registered in memory.");
	}
	return static_cast<u32>(hashed->second);
}

const Memory::AssetEntry& Memory::getAssetEntryByHandle(size_t handle) const {
	if (handle >= m_assetEntries.size()) {
		throw std::runtime_error("[Memory] Asset handle out of range: " + std::to_string(handle) + ".");
	}
	return m_assetEntries[handle];
}

Memory::AssetEntry& Memory::getAssetEntryByHandle(size_t handle) {
	if (handle >= m_assetEntries.size()) {
		throw std::runtime_error("[Memory] Asset handle out of range: " + std::to_string(handle) + ".");
	}
	return m_assetEntries[handle];
}

const Memory::AssetEntry& Memory::getAssetEntry(const std::string& id) const {
	return getAssetEntryByHandle(resolveAssetHandle(id));
}

Memory::AssetEntry& Memory::getAssetEntry(const std::string& id) {
	return getAssetEntryByHandle(resolveAssetHandle(id));
}

const u8* Memory::getImagePixels(const AssetEntry& entry) const {
	if (entry.flags & ASSET_FLAG_VIEW) {
		throw std::runtime_error("[Memory] Image view entries do not expose direct pixel buffers.");
	}
	if (isVramRange(entry.baseAddr, entry.capacity)) {
		throw std::runtime_error("[Memory] Image asset lives in VRAM and has no CPU pixel buffer.");
	}
	const size_t offset = ramOffset(entry.baseAddr, entry.baseSize);
	return m_ram.data() + offset;
}

const u8* Memory::getAudioBytes(const AssetEntry& entry) const {
	const size_t offset = ramOffset(entry.baseAddr, entry.baseSize);
	return m_ram.data() + offset;
}

const u8* Memory::getAudioData(const AssetEntry& entry) const {
	const uint32_t dataAddr = entry.baseAddr + entry.audioDataOffset;
	const size_t offset = ramOffset(dataAddr, entry.audioDataSize);
	return m_ram.data() + offset;
}

Memory::ImageWritePlan Memory::planImageSlotWrite(AssetEntry& entry, size_t pixelBytes, uint32_t width, uint32_t height, uint32_t capacityOverride) {
	const size_t index = m_assetIndexById.at(entry.id);
	const ImageWritePlan plan = planImageWriteEntry(entry, pixelBytes, width, height, capacityOverride);
	if (m_assetTableFinalized) {
		updateAssetEntryData(index, entry);
	}
	return plan;
}

Memory::ImageWritePlan Memory::planImageWrite(ImageWriteEntry& entry, size_t pixelBytes, uint32_t width, uint32_t height, uint32_t capacityOverride) {
	return planImageWriteEntry(entry, pixelBytes, width, height, capacityOverride);
}

void Memory::writeImageSlot(AssetEntry& entry, const u8* pixels, size_t pixelBytes, uint32_t width, uint32_t height, uint32_t capacityOverride) {
	const ImageWritePlan plan = planImageSlotWrite(entry, pixelBytes, width, height, capacityOverride);
	const size_t writeLen = plan.writeLen;
	if (writeLen > 0) {
		const size_t offset = ramOffset(entry.baseAddr, writeLen);
		if (plan.writeWidth == width) {
			std::memcpy(m_ram.data() + offset, pixels, writeLen);
		} else {
			for (uint32_t row = 0; row < plan.writeHeight; ++row) {
				const size_t srcOffset = static_cast<size_t>(row) * plan.sourceStride;
				const size_t dstOffset = offset + static_cast<size_t>(row) * plan.writeStride;
				std::memcpy(m_ram.data() + dstOffset, pixels + srcOffset, plan.writeStride);
			}
		}
		markAssetDirty(entry.baseAddr, static_cast<uint32_t>(writeLen));
	}
}

void Memory::updateImageViewBase(AssetEntry& entry, const AssetEntry& base) {
	const size_t index = m_assetIndexById.at(entry.id);
	entry.baseAddr = base.baseAddr;
	entry.baseSize = base.baseSize;
	entry.baseStride = base.baseStride;
	entry.ownerIndex = base.ownerIndex;
	if (m_assetTableFinalized) {
		updateAssetEntryData(index, entry);
	}
}

void Memory::updateImageView(AssetEntry& entry, const AssetEntry& base, uint32_t regionX, uint32_t regionY, uint32_t regionW, uint32_t regionH, uint32_t flags) {
	const size_t index = m_assetIndexById.at(entry.id);
	entry.flags = flags | ASSET_FLAG_VIEW;
	entry.baseAddr = base.baseAddr;
	entry.baseSize = base.baseSize;
	entry.capacity = 0;
	entry.baseStride = base.baseStride;
	entry.regionX = regionX;
	entry.regionY = regionY;
	entry.regionW = regionW;
	entry.regionH = regionH;
	entry.ownerIndex = base.ownerIndex;
	if (m_assetTableFinalized) {
		updateAssetEntryData(index, entry);
	}
}

Value Memory::readValue(uint32_t addr) const {
	if (isIoAddress(addr)) {
		const size_t slot = ioIndex(addr);
		const IoReadBinding& binding = m_ioReadHandlers[slot];
		if (binding.handler != nullptr) {
			return binding.handler(binding.context, addr);
		}
		return m_ioSlots[slot];
	}
	if (addr < RAM_BASE) {
		return valueFromNumber(static_cast<double>(readU32FromRegion(addr)));
	}
	return valueFromNumber(static_cast<double>(readU32(addr)));
}

Value Memory::readMappedValue(uint32_t addr) const {
	if (isVramRange(addr, 4)) {
		return valueNumber(static_cast<double>(readMappedU32LE(addr)));
	}
	return readValue(addr);
}

void Memory::writeValue(uint32_t addr, Value value) {
	if (isIoAddress(addr)) {
		const size_t slot = ioIndex(addr);
		m_ioSlots[slot] = value;
		const IoWriteBinding& binding = m_ioWriteHandlers[slot];
		if (binding.handler != nullptr) {
			binding.handler(binding.context, addr, value);
		}
		return;
	}
	if (!valueIsNumber(value)) {
		throw std::runtime_error("Bus fault: non-numeric store @ " + formatNumberAsHex(addr, 8) + ".");
	}
	writeU32(addr, toU32(asNumber(value)));
}

void Memory::writeIoValue(uint32_t addr, Value value) {
	if (!isIoAddress(addr)) {
		throw std::runtime_error("I/O fault @ " + formatNumberAsHex(addr, 8) + ": invalid register.");
	}
	m_ioSlots[ioIndex(addr)] = value;
}

void Memory::writeMappedValue(uint32_t addr, Value value) {
	if (!isMappedWritableRange(addr, 4)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write word.");
	}
	if (isVramRange(addr, 4)) {
		if (!valueIsNumber(value)) {
			throw std::runtime_error("VRAM write fault @ " + formatNumberAsHex(addr, 8) + ": non-numeric value.");
		}
		writeMappedU32LE(addr, toU32(asNumber(value)));
		return;
	}
	writeValue(addr, value);
}

u8 Memory::readU8(uint32_t addr) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, 1, offset);
	return region[offset];
}

u8 Memory::readMappedU8(uint32_t addr) const {
	if (isVramRange(addr, 1)) {
		u8 value = 0;
		m_vramWriter->readVram(addr, &value, 1);
		return value;
	}
	if (isIoAddress(addr)) {
		const Value value = readValue(addr);
		if (!valueIsNumber(value)) {
			throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": non-numeric register.");
		}
		return static_cast<u8>(toU32(asNumber(value)) & 0xffu);
	}
	if (isIoRegionRange(addr, 1)) {
		throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": unaligned.");
	}
	return readU8(addr);
}

void Memory::writeU8(uint32_t addr, u8 value) {
	size_t offset = 0;
	if (isVramRange(addr, 1)) {
		m_vramWriter->writeVram(addr, &value, 1);
		return;
	}
	auto* region = writeRegion(addr, 1, offset);
	region[offset] = value;
	markAssetDirty(addr, 1);
}

void Memory::writeMappedU8(uint32_t addr, u8 value) {
	if (!isMappedWritableRange(addr, 1)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write byte.");
	}
	if (isIoAddress(addr)) {
		writeValue(addr, valueNumber(static_cast<double>(value)));
		return;
	}
	writeU8(addr, value);
}

uint32_t Memory::readIoU32(uint32_t addr) const {
	if (!isIoAddress(addr)) {
		throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": invalid register.");
	}
	const Value value = readValue(addr);
	if (!valueIsNumber(value)) {
		throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": non-numeric register.");
	}
	return toU32(asNumber(value));
}

int32_t Memory::readIoI32(uint32_t addr) const {
	return toI32(static_cast<double>(readIoU32(addr)));
}

uint32_t Memory::readU32(uint32_t addr) const {
	if (isVramRange(addr, 4)) {
		throw std::runtime_error("VRAM read fault @ " + formatNumberAsHex(addr, 8) + ": write-only len=4.");
	}
	if (addr < RAM_BASE) {
		return readU32FromRegion(addr);
	}
	const size_t offset = ramOffset(addr, 4);
	uint32_t value = 0;
	std::memcpy(&value, m_ram.data() + offset, sizeof(uint32_t));
	return value;
}

uint32_t Memory::readU32FromRegion(uint32_t addr) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, 4, offset);
	return static_cast<uint32_t>(region[offset])
		| (static_cast<uint32_t>(region[offset + 1]) << 8)
		| (static_cast<uint32_t>(region[offset + 2]) << 16)
		| (static_cast<uint32_t>(region[offset + 3]) << 24);
}

uint32_t Memory::readMappedU16LE(uint32_t addr) const {
	const uint32_t b0 = static_cast<uint32_t>(readMappedU8(addr));
	const uint32_t b1 = static_cast<uint32_t>(readMappedU8(addr + 1));
	return b0 | (b1 << 8);
}

uint32_t Memory::readMappedU32LE(uint32_t addr) const {
	const uint32_t b0 = static_cast<uint32_t>(readMappedU8(addr));
	const uint32_t b1 = static_cast<uint32_t>(readMappedU8(addr + 1));
	const uint32_t b2 = static_cast<uint32_t>(readMappedU8(addr + 2));
	const uint32_t b3 = static_cast<uint32_t>(readMappedU8(addr + 3));
	return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

float Memory::readMappedF32LE(uint32_t addr) const {
	const uint32_t bits = readMappedU32LE(addr);
	float value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

double Memory::readMappedF64LE(uint32_t addr) const {
	const uint64_t lo = static_cast<uint64_t>(readMappedU32LE(addr));
	const uint64_t hi = static_cast<uint64_t>(readMappedU32LE(addr + 4));
	const uint64_t bits = (hi << 32) | lo;
	double value = 0.0;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

void Memory::writeU32(uint32_t addr, uint32_t value) {
	if (isVramRange(addr, 4)) {
		u8 bytes[4] = {
			static_cast<u8>(value & 0xffu),
			static_cast<u8>((value >> 8) & 0xffu),
			static_cast<u8>((value >> 16) & 0xffu),
			static_cast<u8>((value >> 24) & 0xffu),
		};
		m_vramWriter->writeVram(addr, bytes, 4);
		return;
	}
	const size_t offset = ramOffset(addr, 4);
	std::memcpy(m_ram.data() + offset, &value, sizeof(uint32_t));
	markAssetDirty(addr, 4);
}

void Memory::writeMappedU16LE(uint32_t addr, uint32_t value) {
	if (!isMappedWritableRange(addr, 2)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write halfword.");
	}
	writeMappedU8(addr, static_cast<u8>(value & 0xffu));
	writeMappedU8(addr + 1, static_cast<u8>((value >> 8) & 0xffu));
}

void Memory::writeMappedU32LE(uint32_t addr, uint32_t value) {
	if (!isMappedWritableRange(addr, 4)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write word.");
	}
	if (isIoAddress(addr)) {
		writeValue(addr, valueNumber(static_cast<double>(value)));
		return;
	}
	writeMappedU8(addr, static_cast<u8>(value & 0xffu));
	writeMappedU8(addr + 1, static_cast<u8>((value >> 8) & 0xffu));
	writeMappedU8(addr + 2, static_cast<u8>((value >> 16) & 0xffu));
	writeMappedU8(addr + 3, static_cast<u8>((value >> 24) & 0xffu));
}

void Memory::writeMappedF32LE(uint32_t addr, float value) {
	uint32_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, bits);
}

void Memory::writeMappedF64LE(uint32_t addr, double value) {
	if (!isMappedWritableRange(addr, 8)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write doubleword.");
	}
	uint64_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, static_cast<uint32_t>(bits & 0xffffffffull));
	writeMappedU32LE(addr + 4, static_cast<uint32_t>(bits >> 32));
}

void Memory::writeBytes(uint32_t addr, const u8* data, size_t length) {
	size_t offset = 0;
	if (isVramRange(addr, length)) {
		m_vramWriter->writeVram(addr, data, length);
		return;
	}
	auto* region = writeRegion(addr, length, offset);
	std::memcpy(region + offset, data, length);
	markAssetDirty(addr, static_cast<uint32_t>(length));
}

void Memory::readBytes(uint32_t addr, u8* out, size_t length) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, length, offset);
	std::memcpy(out, region + offset, length);
}

bool Memory::isVramRange(uint32_t addr, size_t length) const {
	return isVramRangeLocal(addr, length);
}

bool Memory::isReadableMainMemoryRange(uint32_t addr, size_t length) const {
	return isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, static_cast<uint32_t>(m_engineRom.size))
		|| (m_cartRom.data != nullptr && isRangeWithinRegion(addr, length, CART_ROM_BASE, static_cast<uint32_t>(m_cartRom.size)))
		|| (m_overlayRom.data != nullptr && isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, static_cast<uint32_t>(m_overlayRom.size)))
		|| isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
}

bool Memory::isRamRange(uint32_t addr, size_t length) const {
	return isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
}

void Memory::loadIoSlots(const std::vector<Value>& slots) {
	if (slots.size() != IO_SLOT_COUNT) {
		throw std::runtime_error("[Memory] I/O snapshot slot count mismatch.");
	}
	m_ioSlots = slots;
}

void Memory::clearIoSlots() {
	for (auto& slot : m_ioSlots) {
		slot = valueNil();
	}
}

bool Memory::isIoAddress(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if (delta >= IO_WORD_SIZE * IO_SLOT_COUNT) {
		return false;
	}
	return (delta % IO_WORD_SIZE) == 0;
}

bool Memory::isIoRegionRange(uint32_t addr, size_t length) const {
	return addr >= IO_BASE && addr + length <= IO_BASE + m_ioSlots.size() * IO_WORD_SIZE;
}

size_t Memory::ioIndex(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if ((delta % IO_WORD_SIZE) != 0) {
		throw std::runtime_error("I/O fault @ " + formatNumberAsHex(addr, 8) + ": unaligned.");
	}
	const size_t slot = static_cast<size_t>(delta / IO_WORD_SIZE);
	if (slot >= m_ioSlots.size()) {
		throw std::runtime_error("I/O fault @ " + formatNumberAsHex(addr, 8) + ": out of range.");
	}
	return slot;
}

bool Memory::isRangeWithinRegion(uint32_t addr, size_t length, uint32_t base, uint32_t size) const {
	return addr >= base && addr + length <= base + size;
}

bool Memory::isLuaReadOnlyIoAddress(uint32_t addr) const {
	return addr == IO_SYS_CART_BOOTREADY
		|| addr == IO_SYS_HOST_FAULT_FLAGS
		|| addr == IO_SYS_HOST_FAULT_STAGE
		|| addr == IO_IRQ_FLAGS
		|| addr == IO_DMA_STATUS
		|| addr == IO_DMA_WRITTEN
		|| addr == IO_GEO_STATUS
		|| addr == IO_GEO_PROCESSED
		|| addr == IO_GEO_FAULT
		|| addr == IO_IMG_STATUS
		|| addr == IO_IMG_WRITTEN
		|| addr == IO_APU_STATUS
		|| addr == IO_APU_EVENT_KIND
		|| addr == IO_APU_EVENT_CHANNEL
		|| addr == IO_APU_EVENT_HANDLE
		|| addr == IO_APU_EVENT_VOICE
		|| addr == IO_APU_EVENT_SEQ
		|| addr == IO_VDP_RD_STATUS
		|| addr == IO_VDP_RD_DATA
		|| addr == IO_VDP_STATUS;
}

bool Memory::isMappedWritableRange(uint32_t addr, size_t length) const {
	if (isIoRegionRange(addr, length)) {
		return length == IO_WORD_SIZE && isIoAddress(addr) && !isLuaReadOnlyIoAddress(addr);
	}
	if (isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, static_cast<uint32_t>(m_engineRom.size))) {
		return false;
	}
	if (m_cartRom.data != nullptr && isRangeWithinRegion(addr, length, CART_ROM_BASE, static_cast<uint32_t>(m_cartRom.size))) {
		return false;
	}
	if (m_overlayRom.data != nullptr && isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, static_cast<uint32_t>(m_overlayRom.size))) {
		return false;
	}
	if (isVramRange(addr, length)) {
		return true;
	}
	return addr >= RAM_BASE && addr + length <= RAM_USED_END;
}

size_t Memory::ramOffset(uint32_t addr, size_t length) const {
	if (addr < RAM_BASE || addr + length > RAM_USED_END) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": RAM range len=" + std::to_string(length) + ".");
	}
	return static_cast<size_t>(addr - RAM_BASE);
}

const u8* Memory::readRegion(uint32_t addr, size_t length, size_t& outOffset) const {
	if (isVramRange(addr, length)) {
		throw std::runtime_error("VRAM read fault @ " + formatNumberAsHex(addr, 8) + ": write-only len=" + std::to_string(length) + ".");
	}
	if (m_engineRom.size > 0 && addr >= SYSTEM_ROM_BASE && addr + length <= SYSTEM_ROM_BASE + m_engineRom.size) {
		outOffset = static_cast<size_t>(addr - SYSTEM_ROM_BASE);
		return m_engineRom.data;
	}
	if (m_cartRom.size > 0 && addr >= CART_ROM_BASE && addr + length <= CART_ROM_BASE + m_cartRom.size) {
		outOffset = static_cast<size_t>(addr - CART_ROM_BASE);
		return m_cartRom.data;
	}
	if (m_overlayRom.size > 0 && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + m_overlayRom.size) {
		outOffset = static_cast<size_t>(addr - OVERLAY_ROM_BASE);
		return m_overlayRom.data;
	}
	outOffset = ramOffset(addr, length);
	return m_ram.data();
}

u8* Memory::writeRegion(uint32_t addr, size_t length, size_t& outOffset) {
	if (m_overlayRom.size > 0 && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + m_overlayRom.size) {
		outOffset = static_cast<size_t>(addr - OVERLAY_ROM_BASE);
		return m_overlayRom.data;
	}
	outOffset = ramOffset(addr, length);
	return m_ram.data();
}

void Memory::mapAssetPages(size_t ownerIndex, uint32_t addr, uint32_t size) {
	const uint32_t startPage = (addr - ASSET_DATA_BASE) >> ASSET_PAGE_SHIFT;
	const uint32_t endPage = (addr + size - ASSET_DATA_BASE - 1) >> ASSET_PAGE_SHIFT;
	for (uint32_t page = startPage; page <= endPage; ++page) {
		m_assetOwnerPages[page] = static_cast<int32_t>(ownerIndex);
	}
}

void Memory::markAssetDirty(uint32_t addr, uint32_t size) {
	const uint32_t start = addr < ASSET_DATA_BASE ? ASSET_DATA_BASE : addr;
	uint32_t end = addr + size;
	if (end > ASSET_DATA_END) {
		end = ASSET_DATA_END;
	}
	if (start >= end) {
		return;
	}
	const uint32_t startPage = (start - ASSET_DATA_BASE) >> ASSET_PAGE_SHIFT;
	const uint32_t endPage = (end - ASSET_DATA_BASE - 1) >> ASSET_PAGE_SHIFT;
	for (uint32_t page = startPage; page <= endPage; ++page) {
		const int32_t owner = m_assetOwnerPages[page];
		if (owner < 0) {
			continue;
		}
		const size_t index = static_cast<size_t>(owner);
		if (m_assetDirtyFlags[index] == 0) {
			m_assetDirtyFlags[index] = 1;
			m_assetDirtyList.push_back(index);
		}
	}
}

uint32_t Memory::allocateAssetData(uint32_t size, uint32_t alignment) {
	uint32_t addr = alignment > 1 ? alignUp(m_assetDataCursor, alignment) : m_assetDataCursor;
	const uint32_t end = addr + size;
	if (end > ASSET_DATA_ALLOC_END) {
		throw std::runtime_error("[Memory] RAM exhausted.");
	}
	m_assetDataCursor = end;
	enforceLuaHeapBudget();
	return addr;
}

size_t Memory::addAssetEntry(AssetEntry entry) {
	if (m_assetIndexById.count(entry.id) != 0) {
		throw std::runtime_error("[Memory] Asset entry already registered.");
	}
	entry.idToken = hashAssetToken(entry.id);
	const auto tokenIt = m_assetIndexByToken.find(entry.idToken);
	if (tokenIt != m_assetIndexByToken.end()) {
		throw std::runtime_error("[Memory] Asset token collision detected.");
	}
	const size_t index = m_assetEntries.size();
	m_assetEntries.push_back(std::move(entry));
	m_assetIndexById[m_assetEntries.back().id] = index;
	m_assetIndexByToken[m_assetEntries.back().idToken] = index;
	m_assetDirtyFlags.push_back(0);
	enforceLuaHeapBudget();
	return index;
}

Memory::AssetEntry& Memory::addOwnedAssetEntry(AssetEntry entry, uint32_t addr, uint32_t size) {
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = index;
	mapAssetPages(index, addr, size);
	return m_assetEntries[index];
}

void Memory::writeAssetEntryMutableData(u8* base, uint32_t entryOffset, const AssetEntry& entry) {
	writeU32LE(base + entryOffset + 20, entry.baseAddr);
	writeU32LE(base + entryOffset + 24, entry.baseSize);
	writeU32LE(base + entryOffset + 28, entry.capacity);
	writeAssetEntryPayload(base, entryOffset, entry);
}

void Memory::writeAssetEntryPayload(u8* base, uint32_t entryOffset, const AssetEntry& entry) {
	switch (entry.type) {
		case AssetType::Image:
			writeU32LE(base + entryOffset + 32, entry.baseStride);
			writeU32LE(base + entryOffset + 36, entry.regionX);
			writeU32LE(base + entryOffset + 40, entry.regionY);
			writeU32LE(base + entryOffset + 44, entry.regionW);
			writeU32LE(base + entryOffset + 48, entry.regionH);
			break;
		case AssetType::Audio:
			writeU32LE(base + entryOffset + 32, entry.sampleRate);
			writeU32LE(base + entryOffset + 36, entry.channels);
			writeU32LE(base + entryOffset + 40, entry.frames);
			writeU32LE(base + entryOffset + 44, entry.bitsPerSample);
			writeU32LE(base + entryOffset + 48, entry.audioDataOffset);
			writeU32LE(base + entryOffset + 52, entry.audioDataSize);
			break;
		default:
			throw std::runtime_error("[Memory] Asset entry has unknown type.");
	}
}

void Memory::updateAssetEntryData(size_t index, const AssetEntry& entry) {
	const uint32_t entryAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE + static_cast<uint32_t>(index * ASSET_TABLE_ENTRY_SIZE);
	const uint32_t entryOffset = entryAddr - RAM_BASE;
	writeAssetEntryMutableData(m_ram.data(), entryOffset, entry);
}

} // namespace bmsx
