#include "machine/memory/specs.h"

#include "machine/memory/memory.h"
#include "rompack/format.h"
#include "rompack/assets.h"

#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <unordered_set>

namespace bmsx {
namespace {

constexpr uint32_t ASSET_PAGE_SIZE = 1u << 12;
constexpr uint32_t DEFAULT_ASSET_DATA_HEADROOM_BYTES = 1u << 20; // 1 MiB

void collectAssetIds(const RuntimeAssets& engineAssets, const RuntimeAssets& assets, std::unordered_set<std::string>& ids) {
	(void)assets;
	const std::string engineTextpageId = generateAtlasAssetId(BIOS_ATLAS_ID);
	const ImgAsset* engineTextpage = engineAssets.getImg(engineTextpageId);
	if (!engineTextpage) {
		throw std::runtime_error("[RuntimeMemorySpecs] Engine textpage missing from assets.");
	}
	ids.insert(engineTextpageId);
	ids.insert(TEXTPAGE_PRIMARY_SLOT_ID);
	ids.insert(TEXTPAGE_SECONDARY_SLOT_ID);
	ids.insert(FRAMEBUFFER_TEXTURE_KEY);
	ids.insert(FRAMEBUFFER_RENDER_TEXTURE_KEY);
}

uint32_t computeAssetTableBytes(const RuntimeAssets& engineAssets, const RuntimeAssets& assets) {
	std::unordered_set<std::string> ids;
	collectAssetIds(engineAssets, assets, ids);
	uint64_t stringBytes = 0;
	for (const auto& id : ids) {
		stringBytes += static_cast<uint64_t>(id.size()) + 1u;
	}
	const uint64_t entryCount = ids.size();
	const uint64_t bytes = static_cast<uint64_t>(ASSET_TABLE_HEADER_SIZE)
		+ (entryCount * static_cast<uint64_t>(ASSET_TABLE_ENTRY_SIZE))
		+ stringBytes;
	if (bytes > std::numeric_limits<uint32_t>::max()) {
		throw std::runtime_error("[RuntimeMemorySpecs] Asset table size exceeds addressable range.");
	}
	return static_cast<uint32_t>(bytes);
}

uint64_t alignUpU64(uint64_t value, uint64_t alignment) {
	const uint64_t mask = alignment - 1u;
	return (value + mask) & ~mask;
}

uint32_t computeRequiredAssetDataBytes(const RuntimeAssets& assets) {
	(void)assets;
	uint64_t requiredBytes = 0;
	requiredBytes += static_cast<uint64_t>(DEFAULT_ASSET_DATA_HEADROOM_BYTES);
	requiredBytes = alignUpU64(requiredBytes, static_cast<uint64_t>(ASSET_PAGE_SIZE));
	if (requiredBytes > std::numeric_limits<uint32_t>::max()) {
		throw std::runtime_error("[RuntimeMemorySpecs] required asset data size exceeds addressable range.");
	}
	return static_cast<uint32_t>(requiredBytes);
}

uint32_t resolveSystemTextpageSlotBytes(const RuntimeAssets& engineAssets) {
	const std::string engineTextpageId = generateAtlasAssetId(BIOS_ATLAS_ID);
	const ImgAsset* engineTextpage = engineAssets.getImg(engineTextpageId);
	if (!engineTextpage) {
		throw std::runtime_error("[RuntimeMemorySpecs] Engine textpage missing from assets.");
	}
	const i32 width = engineTextpage->meta.width;
	const i32 height = engineTextpage->meta.height;
	if (width <= 0 || height <= 0) {
		throw std::runtime_error("[RuntimeMemorySpecs] Engine textpage dimensions must be positive.");
	}
	return static_cast<uint32_t>(width) * static_cast<uint32_t>(height) * 4u;
}

} // namespace

MemoryMapConfig resolveRuntimeMemoryMapConfig(const MachineManifest& machine, const MachineManifest& systemMachine, const RuntimeAssets& assets, const RuntimeAssets& engineAssets) {
	MemoryMapConfig config;
	if (machine.textpageSlotBytes) {
		const i32 value = *machine.textpageSlotBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] textpage_slot_bytes must be greater than 0.");
		}
		config.textpageSlotBytes = static_cast<uint32_t>(value);
	}
	if (systemMachine.systemTextpageSlotBytes) {
		const i32 value = *systemMachine.systemTextpageSlotBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] system_textpage_slot_bytes must be greater than 0.");
		}
		config.systemTextpageSlotBytes = static_cast<uint32_t>(value);
	} else {
		config.systemTextpageSlotBytes = resolveSystemTextpageSlotBytes(engineAssets);
	}
	if (machine.stagingBytes) {
		const i32 value = *machine.stagingBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] staging_bytes must be greater than 0.");
		}
		config.stagingBytes = static_cast<uint32_t>(value);
	}
	const uint32_t frameBufferWidth = static_cast<uint32_t>(machine.viewportWidth);
	const uint32_t frameBufferHeight = static_cast<uint32_t>(machine.viewportHeight);
	config.frameBufferBytes = frameBufferWidth * frameBufferHeight * 4u;

	const uint32_t requiredAssetTableBytes = computeAssetTableBytes(engineAssets, assets);
	config.assetTableBytes = requiredAssetTableBytes;
	const uint32_t stringHandleTableBytes = config.stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
	const uint32_t requiredAssetDataBytes = computeRequiredAssetDataBytes(assets);
	const uint64_t assetDataBaseOffset = static_cast<uint64_t>(IO_REGION_SIZE)
		+ static_cast<uint64_t>(stringHandleTableBytes)
		+ static_cast<uint64_t>(config.stringHeapBytes)
		+ static_cast<uint64_t>(config.assetTableBytes);
	const uint64_t assetDataBasePadding = alignUpU64(assetDataBaseOffset, static_cast<uint64_t>(IO_WORD_SIZE)) - assetDataBaseOffset;
	const uint64_t fixedRamBytes = assetDataBaseOffset
		+ assetDataBasePadding
		+ static_cast<uint64_t>(DEFAULT_GEO_SCRATCH_SIZE)
		+ static_cast<uint64_t>(VDP_STREAM_BUFFER_SIZE);
	const uint64_t requiredRamBytes = fixedRamBytes + static_cast<uint64_t>(requiredAssetDataBytes);
	if (requiredRamBytes > std::numeric_limits<uint32_t>::max()) {
		throw std::runtime_error("[RuntimeMemorySpecs] ram_bytes exceeds addressable range.");
	}
	const uint32_t minimumRamBytes = static_cast<uint32_t>(requiredRamBytes);
	if (machine.ramBytes) {
		const i32 value = *machine.ramBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] ram_bytes must be greater than 0.");
		}
		const uint32_t resolved = static_cast<uint32_t>(value);
		if (resolved < minimumRamBytes) {
			throw std::runtime_error("[RuntimeMemorySpecs] ram_bytes must be at least required size.");
		}
		config.ramBytes = resolved;
		config.assetDataBytes = resolved - static_cast<uint32_t>(fixedRamBytes);
	} else {
		config.ramBytes = minimumRamBytes;
		config.assetDataBytes = requiredAssetDataBytes;
	}
	const double ramMiB = static_cast<double>(config.ramBytes) / (1024.0 * 1024.0);
	std::cerr
		<< "[RuntimeMemorySpecs] memory footprint: ram=" << config.ramBytes << " bytes ("
		<< std::fixed << std::setprecision(2) << ramMiB << " MiB) "
		<< "(io=" << IO_REGION_SIZE
		<< ", string_handles=" << config.stringHandleCount
		<< ", string_heap=" << config.stringHeapBytes
		<< ", asset_table=" << config.assetTableBytes
		<< ", asset_data=" << config.assetDataBytes
		<< ", geo_scratch=" << DEFAULT_GEO_SCRATCH_SIZE
		<< ", vdp_stream=" << VDP_STREAM_BUFFER_SIZE
		<< ", vram_staging=" << config.stagingBytes
		<< ", framebuffer=" << config.frameBufferBytes
		<< ", engine_textpage_slot=" << config.systemTextpageSlotBytes
		<< ", textpage_slot=" << config.textpageSlotBytes << "x2=" << (config.textpageSlotBytes * 2u)
		<< ")." << std::endl;
	return config;
}

void applyManifestMemorySpecs(const MachineManifest& machine, const MachineManifest& systemMachine, const RuntimeAssets& assets, const RuntimeAssets& engineAssets) {
	const MemoryMapConfig config = resolveRuntimeMemoryMapConfig(machine, systemMachine, assets, engineAssets);
	configureMemoryMap(config);
}

} // namespace bmsx
