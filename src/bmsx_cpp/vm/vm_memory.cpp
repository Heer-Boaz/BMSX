#include "vm_memory.h"

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr uint32_t ASSET_TABLE_MAGIC = 0x32534D41u; // 'AMS2'
constexpr uint32_t ASSET_TABLE_HEADER_SIZE = 40;
constexpr uint32_t ASSET_TABLE_ENTRY_SIZE = 64;
// 1 = FNV-1a 64 over canonical UTF-8 (lowercase, slash-normalized, collapse "//", trim leading "./").
constexpr uint32_t ASSET_TABLE_HASH_ALG_ID = 1;
constexpr uint32_t ASSET_PAGE_SHIFT = 12;
constexpr uint32_t ASSET_PAGE_SIZE = 1u << ASSET_PAGE_SHIFT;
constexpr uint32_t ASSET_TYPE_IMAGE = 1;
constexpr uint32_t ASSET_TYPE_AUDIO = 2;
constexpr uint32_t ASSET_FLAG_VIEW = 1u << 1;
constexpr uint64_t ASSET_TOKEN_OFFSET_BASIS = 0xcbf29ce484222325ull;
constexpr uint64_t ASSET_TOKEN_PRIME = 0x100000001b3ull;

inline uint32_t alignUp(uint32_t value, uint32_t alignment) {
	const uint32_t mask = alignment - 1;
	return (value + mask) & ~mask;
}

inline void writeU32LE(u8* dst, uint32_t value) {
	dst[0] = static_cast<u8>(value & 0xffu);
	dst[1] = static_cast<u8>((value >> 8) & 0xffu);
	dst[2] = static_cast<u8>((value >> 16) & 0xffu);
	dst[3] = static_cast<u8>((value >> 24) & 0xffu);
}

std::string canonicalizeAssetId(const std::string& id) {
	std::string out;
	out.reserve(id.size());
	size_t index = 0;
	if (id.size() >= 2 && id[0] == '.' && (id[1] == '/' || id[1] == '\\')) {
		index = 2;
	}
	bool prevSlash = false;
	for (; index < id.size(); ++index) {
		unsigned char c = static_cast<unsigned char>(id[index]);
		if (c == '\\') {
			c = '/';
		}
		if (c == '/') {
			if (prevSlash) {
				continue;
			}
			prevSlash = true;
			out.push_back('/');
			continue;
		}
		prevSlash = false;
		if (c >= 'A' && c <= 'Z') {
			c = static_cast<unsigned char>(c - 'A' + 'a');
		}
		out.push_back(static_cast<char>(c));
	}
	return out;
}

uint64_t hashAssetId(const std::string& id) {
	const std::string canonical = canonicalizeAssetId(id);
	uint64_t hash = ASSET_TOKEN_OFFSET_BASIS;
	for (unsigned char c : canonical) {
		hash ^= static_cast<uint64_t>(c);
		hash *= ASSET_TOKEN_PRIME;
	}
	return hash;
}
}

VmMemory::VmMemory()
	: m_ram(RAM_USED_END - RAM_BASE)
	, m_ioSlots(VM_IO_SLOT_COUNT, valueNil()) {
	const size_t pageCount = (ASSET_DATA_END - ASSET_DATA_BASE + ASSET_PAGE_SIZE - 1) / ASSET_PAGE_SIZE;
	m_assetOwnerPages.assign(pageCount, -1);
	resetAssetMemory();
}

void VmMemory::setEngineRom(const u8* data, size_t size) {
	if (size == 0) {
		m_engineRom = {};
		return;
	}
	m_engineRom = { data, size };
}

void VmMemory::setCartRom(const u8* data, size_t size) {
	if (size == 0) {
		m_cartRom = {};
		return;
	}
	m_cartRom = { data, size };
}

void VmMemory::setOverlayRom(u8* data, size_t size) {
	if (size == 0) {
		m_overlayRom = {};
		return;
	}
	m_overlayRom = { data, size };
}

void VmMemory::resetAssetMemory() {
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
	const size_t offset = static_cast<size_t>(ASSET_RAM_BASE - RAM_BASE);
	std::fill(m_ram.begin() + offset, m_ram.begin() + offset + ASSET_RAM_SIZE, 0);
}

bool VmMemory::hasAsset(const std::string& id) const {
	if (m_assetIndexById.find(id) != m_assetIndexById.end()) {
		return true;
	}
	const uint64_t token = hashAssetId(id);
	return m_assetIndexByToken.find(token) != m_assetIndexByToken.end();
}

void VmMemory::sealEngineAssets() {
	m_engineAssetEntryCount = m_assetEntries.size();
	m_engineAssetDataEnd = m_assetDataCursor;
	const uint32_t mask = ASSET_PAGE_SIZE - 1u;
	const uint32_t aligned = (m_engineAssetDataEnd + mask) & ~mask;
	if (aligned > ASSET_DATA_ALLOC_END) {
		throw std::runtime_error("[VmMemory] Engine asset data exceeds asset RAM.");
	}
	m_cartAssetDataBase = aligned;
}

void VmMemory::resetCartAssets() {
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
		mapAssetPages(index, entry.baseAddr, entry.capacity);
	}
	m_assetDataCursor = m_cartAssetDataBase;
	const size_t cartOffset = static_cast<size_t>(m_cartAssetDataBase - RAM_BASE);
	const size_t cartEnd = static_cast<size_t>(ASSET_DATA_ALLOC_END - RAM_BASE);
	std::fill(m_ram.begin() + cartOffset, m_ram.begin() + cartEnd, 0);
}

VmMemory::AssetEntry& VmMemory::registerImageBuffer(const std::string& id, const u8* rgba, uint32_t width, uint32_t height, uint32_t flags) {
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
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = index;
	mapAssetPages(index, addr, size);
	return m_assetEntries[index];
}

VmMemory::AssetEntry& VmMemory::registerImageSlot(const std::string& id, uint32_t capacityBytes, uint32_t flags) {
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
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = index;
	mapAssetPages(index, addr, capacityBytes);
	return m_assetEntries[index];
}

VmMemory::AssetEntry& VmMemory::registerImageSlotAt(const std::string& id, uint32_t baseAddr, uint32_t capacityBytes, uint32_t flags) {
	if (baseAddr < RAM_BASE || baseAddr + capacityBytes > RAM_USED_END) {
		throw std::runtime_error("[VmMemory] Image slot out of RAM bounds.");
	}
	const size_t offset = static_cast<size_t>(baseAddr - RAM_BASE);
	std::memset(m_ram.data() + offset, 0, capacityBytes);
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
	mapAssetPages(index, baseAddr, capacityBytes);
	return m_assetEntries[index];
}

VmMemory::AssetEntry& VmMemory::registerImageView(const std::string& id, const AssetEntry& base, uint32_t regionX, uint32_t regionY, uint32_t regionW, uint32_t regionH, uint32_t flags) {
	AssetEntry entry;
	entry.id = id;
	entry.type = AssetType::Image;
	entry.flags = flags | ASSET_FLAG_VIEW;
	entry.ownerIndex = base.ownerIndex;
	entry.baseAddr = base.baseAddr;
	entry.baseSize = base.baseSize;
	entry.capacity = 0;
	entry.baseStride = base.baseStride;
	entry.regionX = regionX;
	entry.regionY = regionY;
	entry.regionW = regionW;
	entry.regionH = regionH;
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = base.ownerIndex;
	return m_assetEntries[index];
}

VmMemory::AssetEntry& VmMemory::registerAudioBuffer(
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
	AssetEntry entry;
	entry.id = id;
	entry.type = AssetType::Audio;
	entry.baseAddr = addr;
	entry.baseSize = size;
	entry.capacity = size;
	entry.sampleRate = sampleRate;
	entry.channels = channels;
	entry.frames = frames;
	entry.bitsPerSample = bitsPerSample;
	entry.audioDataOffset = dataOffset;
	entry.audioDataSize = dataSize;
	const size_t index = addAssetEntry(std::move(entry));
	m_assetEntries[index].ownerIndex = index;
	mapAssetPages(index, addr, size);
	return m_assetEntries[index];
}

void VmMemory::finalizeAssetTable() {
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
		throw std::runtime_error("[VmMemory] Asset table overflow.");
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
				throw std::runtime_error("[VmMemory] Asset entry has unknown type.");
		}
		const uint32_t idAddr = stringTableAddr + stringOffsets.at(entry.id);
		const uint32_t tokenLo = static_cast<uint32_t>(entry.idToken & 0xffffffffu);
		const uint32_t tokenHi = static_cast<uint32_t>((entry.idToken >> 32) & 0xffffffffu);
		writeU32LE(base + entryOffset + 0, typeId);
		writeU32LE(base + entryOffset + 4, entry.flags);
		writeU32LE(base + entryOffset + 8, tokenLo);
		writeU32LE(base + entryOffset + 12, tokenHi);
		writeU32LE(base + entryOffset + 16, idAddr);
		writeU32LE(base + entryOffset + 20, entry.baseAddr);
		writeU32LE(base + entryOffset + 24, entry.baseSize);
		writeU32LE(base + entryOffset + 28, entry.capacity);
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
				throw std::runtime_error("[VmMemory] Asset entry has unknown type.");
		}
	}

	const uint32_t stringOffset = stringTableAddr - RAM_BASE;
	std::memcpy(base + stringOffset, stringTable.data(), stringTable.size());
	m_assetTableFinalized = true;
}

std::vector<VmMemory::AssetEntry*> VmMemory::consumeDirtyAssets() {
	std::vector<AssetEntry*> entries;
	entries.reserve(m_assetDirtyList.size());
	for (const size_t index : m_assetDirtyList) {
		entries.push_back(&m_assetEntries[index]);
		m_assetDirtyFlags[index] = 0;
	}
	m_assetDirtyList.clear();
	return entries;
}

void VmMemory::markAllAssetsDirty() {
	for (size_t index = 0; index < m_assetEntries.size(); ++index) {
		if (m_assetEntries[index].ownerIndex != index) {
			continue;
		}
		if (m_assetDirtyFlags[index] == 0) {
			m_assetDirtyFlags[index] = 1;
			m_assetDirtyList.push_back(index);
		}
	}
}

std::vector<u8> VmMemory::dumpAssetMemory() const {
	std::vector<u8> snapshot(ASSET_RAM_SIZE);
	const size_t offset = static_cast<size_t>(ASSET_RAM_BASE - RAM_BASE);
	std::memcpy(snapshot.data(), m_ram.data() + offset, snapshot.size());
	return snapshot;
}

void VmMemory::restoreAssetMemory(const u8* data, size_t size) {
	if (size != ASSET_RAM_SIZE) {
		throw std::runtime_error("[VmMemory] Asset RAM snapshot length mismatch.");
	}
	const size_t offset = static_cast<size_t>(ASSET_RAM_BASE - RAM_BASE);
	std::memcpy(m_ram.data() + offset, data, size);
	markAllAssetsDirty();
}

const VmMemory::AssetEntry& VmMemory::getAssetEntry(const std::string& id) const {
	return m_assetEntries.at(m_assetIndexById.at(id));
}

VmMemory::AssetEntry& VmMemory::getAssetEntry(const std::string& id) {
	return m_assetEntries.at(m_assetIndexById.at(id));
}

const u8* VmMemory::getImagePixels(const AssetEntry& entry) const {
	if (entry.flags & ASSET_FLAG_VIEW) {
		throw std::runtime_error("[VmMemory] Image view entries do not expose direct pixel buffers.");
	}
	const size_t offset = ramOffset(entry.baseAddr, entry.baseSize);
	return m_ram.data() + offset;
}

const u8* VmMemory::getAudioBytes(const AssetEntry& entry) const {
	const size_t offset = ramOffset(entry.baseAddr, entry.baseSize);
	return m_ram.data() + offset;
}

const u8* VmMemory::getAudioData(const AssetEntry& entry) const {
	const uint32_t dataAddr = entry.baseAddr + entry.audioDataOffset;
	const size_t offset = ramOffset(dataAddr, entry.audioDataSize);
	return m_ram.data() + offset;
}

void VmMemory::writeImageSlot(AssetEntry& entry, const u8* pixels, size_t pixelBytes, uint32_t width, uint32_t height) {
	const size_t index = m_assetIndexById.at(entry.id);
	const uint32_t capacity = entry.capacity;
	const uint32_t stride = width * 4u;
	const uint32_t size = stride * height;
	const size_t writeLen = std::min(pixelBytes, static_cast<size_t>(capacity));
	if (writeLen > 0) {
		const size_t offset = ramOffset(entry.baseAddr, writeLen);
		std::memcpy(m_ram.data() + offset, pixels, writeLen);
	}
	entry.baseSize = std::min(size, capacity);
	entry.baseStride = stride;
	entry.regionX = 0;
	entry.regionY = 0;
	entry.regionW = width;
	entry.regionH = height;
	if (m_assetTableFinalized) {
		updateAssetEntryData(index, entry);
	}
	if (writeLen > 0) {
		markAssetDirty(entry.baseAddr, static_cast<uint32_t>(writeLen));
	}
}

void VmMemory::updateImageViewBase(AssetEntry& entry, const AssetEntry& base) {
	const size_t index = m_assetIndexById.at(entry.id);
	entry.baseAddr = base.baseAddr;
	entry.baseSize = base.baseSize;
	entry.baseStride = base.baseStride;
	entry.ownerIndex = base.ownerIndex;
	if (m_assetTableFinalized) {
		updateAssetEntryData(index, entry);
	}
}

Value VmMemory::readValue(uint32_t addr) const {
	if (isIoAddress(addr)) {
		return m_ioSlots[ioIndex(addr)];
	}
	if (addr < RAM_BASE) {
		return valueFromNumber(static_cast<double>(readU32FromRegion(addr)));
	}
	return valueFromNumber(static_cast<double>(readU32(addr)));
}

void VmMemory::writeValue(uint32_t addr, Value value) {
	if (isIoAddress(addr)) {
		m_ioSlots[ioIndex(addr)] = value;
		return;
	}
	if (!valueIsNumber(value)) {
		throw std::runtime_error("[VmMemory] STORE_MEM expects a number outside IO space.");
	}
	writeU32(addr, static_cast<uint32_t>(asNumber(value)));
}

u8 VmMemory::readU8(uint32_t addr) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, 1, offset);
	return region[offset];
}

void VmMemory::writeU8(uint32_t addr, u8 value) {
	size_t offset = 0;
	auto* region = writeRegion(addr, 1, offset);
	region[offset] = value;
	markAssetDirty(addr, 1);
}

uint32_t VmMemory::readU32(uint32_t addr) const {
	const size_t offset = ramOffset(addr, 4);
	uint32_t value = 0;
	std::memcpy(&value, m_ram.data() + offset, sizeof(uint32_t));
	return value;
}

uint32_t VmMemory::readU32FromRegion(uint32_t addr) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, 4, offset);
	return static_cast<uint32_t>(region[offset])
		| (static_cast<uint32_t>(region[offset + 1]) << 8)
		| (static_cast<uint32_t>(region[offset + 2]) << 16)
		| (static_cast<uint32_t>(region[offset + 3]) << 24);
}

void VmMemory::writeU32(uint32_t addr, uint32_t value) {
	const size_t offset = ramOffset(addr, 4);
	std::memcpy(m_ram.data() + offset, &value, sizeof(uint32_t));
	markAssetDirty(addr, 4);
}

void VmMemory::writeBytes(uint32_t addr, const u8* data, size_t length) {
	size_t offset = 0;
	auto* region = writeRegion(addr, length, offset);
	std::memcpy(region + offset, data, length);
	markAssetDirty(addr, static_cast<uint32_t>(length));
}

void VmMemory::readBytes(uint32_t addr, u8* out, size_t length) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, length, offset);
	std::memcpy(out, region + offset, length);
}

void VmMemory::loadIoSlots(const std::vector<Value>& slots) {
	m_ioSlots = slots;
	if (m_ioSlots.size() < VM_IO_SLOT_COUNT) {
		m_ioSlots.resize(VM_IO_SLOT_COUNT, valueNil());
	}
}

void VmMemory::clearIoSlots() {
	for (auto& slot : m_ioSlots) {
		slot = valueNil();
	}
}

bool VmMemory::isIoAddress(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if (delta >= IO_WORD_SIZE * VM_IO_SLOT_COUNT) {
		return false;
	}
	return (delta % IO_WORD_SIZE) == 0;
}

size_t VmMemory::ioIndex(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if ((delta % IO_WORD_SIZE) != 0) {
		throw std::runtime_error("[VmMemory] Unaligned IO address.");
	}
	const size_t slot = static_cast<size_t>(delta / IO_WORD_SIZE);
	if (slot >= m_ioSlots.size()) {
		throw std::runtime_error("[VmMemory] IO address out of range.");
	}
	return slot;
}

size_t VmMemory::ramOffset(uint32_t addr, size_t length) const {
	if (addr < RAM_BASE || addr + length > RAM_USED_END) {
		throw std::runtime_error("[VmMemory] Address out of RAM bounds.");
	}
	return static_cast<size_t>(addr - RAM_BASE);
}

const u8* VmMemory::readRegion(uint32_t addr, size_t length, size_t& outOffset) const {
	if (m_engineRom.size > 0 && addr >= ENGINE_ROM_BASE && addr + length <= ENGINE_ROM_BASE + m_engineRom.size) {
		outOffset = static_cast<size_t>(addr - ENGINE_ROM_BASE);
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

u8* VmMemory::writeRegion(uint32_t addr, size_t length, size_t& outOffset) {
	if (m_overlayRom.size > 0 && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + m_overlayRom.size) {
		outOffset = static_cast<size_t>(addr - OVERLAY_ROM_BASE);
		return m_overlayRom.data;
	}
	outOffset = ramOffset(addr, length);
	return m_ram.data();
}

void VmMemory::mapAssetPages(size_t ownerIndex, uint32_t addr, uint32_t size) {
	const uint32_t startPage = (addr - ASSET_DATA_BASE) >> ASSET_PAGE_SHIFT;
	const uint32_t endPage = (addr + size - ASSET_DATA_BASE - 1) >> ASSET_PAGE_SHIFT;
	for (uint32_t page = startPage; page <= endPage; ++page) {
		m_assetOwnerPages[page] = static_cast<int32_t>(ownerIndex);
	}
}

void VmMemory::markAssetDirty(uint32_t addr, uint32_t size) {
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

uint32_t VmMemory::allocateAssetData(uint32_t size, uint32_t alignment) {
	uint32_t addr = alignment > 1 ? alignUp(m_assetDataCursor, alignment) : m_assetDataCursor;
	const uint32_t end = addr + size;
	if (end > ASSET_DATA_ALLOC_END) {
		throw std::runtime_error("[VmMemory] Asset RAM exhausted.");
	}
	m_assetDataCursor = end;
	return addr;
}

size_t VmMemory::addAssetEntry(AssetEntry entry) {
	if (m_assetIndexById.count(entry.id) != 0) {
		throw std::runtime_error("[VmMemory] Asset entry already registered.");
	}
	entry.idToken = hashAssetId(entry.id);
	const auto tokenIt = m_assetIndexByToken.find(entry.idToken);
	if (tokenIt != m_assetIndexByToken.end()) {
		throw std::runtime_error("[VmMemory] Asset token collision detected.");
	}
	const size_t index = m_assetEntries.size();
	m_assetEntries.push_back(std::move(entry));
	m_assetIndexById[m_assetEntries.back().id] = index;
	m_assetIndexByToken[m_assetEntries.back().idToken] = index;
	m_assetDirtyFlags.push_back(0);
	return index;
}

void VmMemory::updateAssetEntryData(size_t index, const AssetEntry& entry) {
	const uint32_t entryAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE + static_cast<uint32_t>(index * ASSET_TABLE_ENTRY_SIZE);
	const uint32_t entryOffset = entryAddr - RAM_BASE;
	writeU32LE(m_ram.data() + entryOffset + 20, entry.baseAddr);
	writeU32LE(m_ram.data() + entryOffset + 24, entry.baseSize);
	writeU32LE(m_ram.data() + entryOffset + 28, entry.capacity);
	switch (entry.type) {
		case AssetType::Image:
			writeU32LE(m_ram.data() + entryOffset + 32, entry.baseStride);
			writeU32LE(m_ram.data() + entryOffset + 36, entry.regionX);
			writeU32LE(m_ram.data() + entryOffset + 40, entry.regionY);
			writeU32LE(m_ram.data() + entryOffset + 44, entry.regionW);
			writeU32LE(m_ram.data() + entryOffset + 48, entry.regionH);
			break;
		case AssetType::Audio:
			writeU32LE(m_ram.data() + entryOffset + 32, entry.sampleRate);
			writeU32LE(m_ram.data() + entryOffset + 36, entry.channels);
			writeU32LE(m_ram.data() + entryOffset + 40, entry.frames);
			writeU32LE(m_ram.data() + entryOffset + 44, entry.bitsPerSample);
			writeU32LE(m_ram.data() + entryOffset + 48, entry.audioDataOffset);
			writeU32LE(m_ram.data() + entryOffset + 52, entry.audioDataSize);
			break;
		default:
			throw std::runtime_error("[VmMemory] Asset entry has unknown type.");
	}
}

} // namespace bmsx
