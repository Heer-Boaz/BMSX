/*
 * engine.cpp - Core engine implementation
 */

#include "engine_core.h"
#include "../input/input.h"
#include "../render/texturemanager.h"
#include "../emulator/runtime.h"
#include "../emulator/program_linker.h"
#include "../emulator/font.h"
#include "../rompack/rompack.h"
#include "../emulator/memory_map.h"
#include "../utils/clamp.h"
#include <cstdio>
#include <chrono>
#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <limits>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr double MAX_FRAME_DELTA_MS = 250.0;
constexpr int MAX_SUBSTEPS = 5;
inline f64 to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<f64, std::milli>(duration).count();
}

constexpr uint32_t ASSET_PAGE_SIZE = 1u << 12;
constexpr uint32_t DEFAULT_ASSET_DATA_HEADROOM_BYTES = 1u << 20; // 1 MiB

void collectAssetIds(const RuntimeAssets& engineAssets, const RuntimeAssets& assets, std::unordered_set<std::string>& ids) {
	const std::string engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
	const ImgAsset* engineAtlas = engineAssets.getImg(engineAtlasId);
	if (!engineAtlas) {
		throw std::runtime_error("[EngineCore] Engine atlas missing from assets.");
	}
	ids.insert(engineAtlasId);
	ids.insert(ATLAS_PRIMARY_SLOT_ID);
	ids.insert(ATLAS_SECONDARY_SLOT_ID);

	for (const auto& entry : engineAssets.img) {
		const auto& imgAsset = entry.second;
		if (imgAsset.meta.atlassed) {
			ids.insert(imgAsset.id);
		}
	}
	for (const auto& entry : assets.img) {
		const auto& imgAsset = entry.second;
		if (imgAsset.meta.atlassed) {
			ids.insert(imgAsset.id);
		}
	}

	for (const auto& entry : engineAssets.audio) {
		ids.insert(entry.second.id);
	}
	for (const auto& entry : assets.audio) {
		ids.insert(entry.second.id);
	}
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
		throw std::runtime_error("[EngineCore] Asset table size exceeds addressable range.");
	}
	return static_cast<uint32_t>(bytes);
}

uint64_t alignUpU64(uint64_t value, uint64_t alignment) {
	const uint64_t mask = alignment - 1u;
	return (value + mask) & ~mask;
}

uint32_t computeRequiredAssetDataBytes(const RuntimeAssets& engineAssets, const RuntimeAssets& assets) {
	std::unordered_map<std::string, const ImgAsset*> imagesById;
	imagesById.reserve(engineAssets.img.size() + assets.img.size());
	for (const auto& entry : engineAssets.img) {
		imagesById[entry.second.id] = &entry.second;
	}
	for (const auto& entry : assets.img) {
		imagesById[entry.second.id] = &entry.second;
	}

	std::unordered_map<std::string, const AudioAsset*> audioById;
	audioById.reserve(engineAssets.audio.size() + assets.audio.size());
	for (const auto& entry : engineAssets.audio) {
		audioById[entry.second.id] = &entry.second;
	}
	for (const auto& entry : assets.audio) {
		audioById[entry.second.id] = &entry.second;
	}

	uint64_t requiredBytes = 0;
	for (const auto& entry : imagesById) {
		const ImgAsset& image = *entry.second;
		if (image.rom.type == "atlas" || image.meta.atlassed || image.pixels.empty()) {
			continue;
		}
		requiredBytes += alignUpU64(static_cast<uint64_t>(image.pixels.size()), 4u);
	}
	for (const auto& entry : audioById) {
		const AudioAsset& audio = *entry.second;
		if (audio.bytes.empty()) {
			continue;
		}
		requiredBytes += alignUpU64(static_cast<uint64_t>(audio.bytes.size()), 2u);
	}
	requiredBytes += static_cast<uint64_t>(DEFAULT_ASSET_DATA_HEADROOM_BYTES);
	requiredBytes = alignUpU64(requiredBytes, static_cast<uint64_t>(ASSET_PAGE_SIZE));
	if (requiredBytes > std::numeric_limits<uint32_t>::max()) {
		throw std::runtime_error("[EngineCore] required asset data size exceeds addressable range.");
	}
	return static_cast<uint32_t>(requiredBytes);
}

MemoryMapConfig resolveMemoryMapConfig(const RomManifest& manifest, const RomManifest& engineManifest, const RuntimeAssets& assets, const RuntimeAssets& engineAssets) {
	MemoryMapConfig config;
	if (manifest.stringHandleCount) {
		const i32 value = *manifest.stringHandleCount;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] string_handle_count must be greater than 0.");
		}
		config.stringHandleCount = static_cast<uint32_t>(value);
	}
	if (manifest.stringHeapBytes) {
		const i32 value = *manifest.stringHeapBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] string_heap_bytes must be greater than 0.");
		}
		config.stringHeapBytes = static_cast<uint32_t>(value);
	}
	if (manifest.atlasSlotBytes) {
		const i32 value = *manifest.atlasSlotBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] atlas_slot_bytes must be greater than 0.");
		}
		config.atlasSlotBytes = static_cast<uint32_t>(value);
	}
	if (engineManifest.engineAtlasSlotBytes) {
		const i32 value = *engineManifest.engineAtlasSlotBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] system_atlas_slot_bytes must be greater than 0.");
		}
		config.engineAtlasSlotBytes = static_cast<uint32_t>(value);
	} else {
		throw std::runtime_error("[EngineCore] system_atlas_slot_bytes is required in the engine manifest.");
	}
	if (manifest.stagingBytes) {
		const i32 value = *manifest.stagingBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] staging_bytes must be greater than 0.");
		}
		config.stagingBytes = static_cast<uint32_t>(value);
	}
	if (manifest.skyboxFaceBytes) {
		const i32 value = *manifest.skyboxFaceBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] skybox_face_bytes must be greater than 0.");
		}
		config.skyboxFaceBytes = static_cast<uint32_t>(value);
	} else {
		const i32 faceSize = manifest.skyboxFaceSize > 0
			? manifest.skyboxFaceSize
			: SKYBOX_FACE_DEFAULT_SIZE;
		if (faceSize <= 0) {
			throw std::runtime_error("[EngineCore] skybox_face_size must be greater than 0.");
		}
		config.skyboxFaceBytes = static_cast<uint32_t>(faceSize) * static_cast<uint32_t>(faceSize) * 4u;
	}

	const uint32_t requiredAssetTableBytes = computeAssetTableBytes(engineAssets, assets);
	if (manifest.assetTableBytes) {
		const i32 value = *manifest.assetTableBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] asset_table_bytes must be greater than 0.");
		}
		const uint32_t resolved = static_cast<uint32_t>(value);
		if (resolved != requiredAssetTableBytes) {
			throw std::runtime_error("[EngineCore] asset_table_bytes must match required size.");
		}
		config.assetTableBytes = resolved;
	} else {
		config.assetTableBytes = requiredAssetTableBytes;
	}

	const uint32_t stringHandleTableBytes = config.stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
	const uint32_t requiredAssetDataBytes = computeRequiredAssetDataBytes(engineAssets, assets);
	if (manifest.assetDataBytes) {
		const i32 value = *manifest.assetDataBytes;
		if (value < 0) {
			throw std::runtime_error("[EngineCore] asset_data_bytes must be greater than or equal to 0.");
		}
		const uint32_t resolved = static_cast<uint32_t>(value);
		if (resolved < requiredAssetDataBytes) {
			throw std::runtime_error("[EngineCore] asset_data_bytes must be at least required size.");
		}
		config.assetDataBytes = resolved;
	} else {
		config.assetDataBytes = requiredAssetDataBytes;
	}

	const uint64_t computedRamBytes = static_cast<uint64_t>(IO_REGION_SIZE)
		+ static_cast<uint64_t>(stringHandleTableBytes)
		+ static_cast<uint64_t>(config.stringHeapBytes)
		+ static_cast<uint64_t>(config.assetTableBytes)
		+ static_cast<uint64_t>(config.assetDataBytes);
	if (computedRamBytes > std::numeric_limits<uint32_t>::max()) {
		throw std::runtime_error("[EngineCore] ram_bytes exceeds addressable range.");
	}
	const uint32_t requiredRamBytes = static_cast<uint32_t>(computedRamBytes);
	if (manifest.ramBytes) {
		const i32 value = *manifest.ramBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] ram_bytes must be greater than 0.");
		}
		const uint32_t resolved = static_cast<uint32_t>(value);
		if (resolved != requiredRamBytes) {
			throw std::runtime_error("[EngineCore] ram_bytes must match required size.");
		}
		config.ramBytes = resolved;
	} else {
		config.ramBytes = requiredRamBytes;
	}
	const double ramMiB = static_cast<double>(config.ramBytes) / (1024.0 * 1024.0);
	std::cerr
		<< "[EngineCore] memory footprint: ram=" << config.ramBytes << " bytes ("
		<< std::fixed << std::setprecision(2) << ramMiB << " MiB) "
		<< "(io=" << IO_REGION_SIZE
		<< ", string_handles=" << config.stringHandleCount
		<< ", string_heap=" << config.stringHeapBytes
		<< ", asset_table=" << config.assetTableBytes
		<< ", asset_data=" << config.assetDataBytes
		<< ", vram_staging=" << config.stagingBytes
		<< ", engine_atlas_slot=" << config.engineAtlasSlotBytes
		<< ", atlas_slot=" << config.atlasSlotBytes << "x2=" << (config.atlasSlotBytes * 2u)
		<< ")." << std::endl;
	return config;
}

void applyManifestMemorySpecs(const RomManifest& manifest, const RomManifest& engineManifest, const RuntimeAssets& assets, const RuntimeAssets& engineAssets) {
	const MemoryMapConfig config = resolveMemoryMapConfig(manifest, engineManifest, assets, engineAssets);
	configureMemoryMap(config);
}

bool tryResolveCpuHz(const RomManifest& manifest, i64& outHz) {
	if (!manifest.cpuHz) {
		return false;
	}
	const i64 hz = *manifest.cpuHz;
	if (hz <= 0) {
		return false;
	}
	outHz = hz;
	return true;
}

i64 resolveCpuHz(const RomManifest& manifest) {
	if (!manifest.cpuHz) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz is required.");
	}
	const i64 hz = *manifest.cpuHz;
	if (hz <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz must be a positive integer.");
	}
	return hz;
}

i64 resolveImgDecBytesPerSec(const RomManifest& manifest) {
	if (!manifest.imgDecBytesPerSec) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.imgdec_bytes_per_sec is required.");
	}
	const i64 value = *manifest.imgDecBytesPerSec;
	if (value <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.imgdec_bytes_per_sec must be a positive integer.");
	}
	return value;
}

i64 resolveDmaBytesPerSecIso(const RomManifest& manifest) {
	if (!manifest.dmaBytesPerSecIso) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_iso is required.");
	}
	const i64 value = *manifest.dmaBytesPerSecIso;
	if (value <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_iso must be a positive integer.");
	}
	return value;
}

i64 resolveDmaBytesPerSecBulk(const RomManifest& manifest) {
	if (!manifest.dmaBytesPerSecBulk) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_bulk is required.");
	}
	const i64 value = *manifest.dmaBytesPerSecBulk;
	if (value <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_bulk must be a positive integer.");
	}
	return value;
}

bool tryResolveUfpsScaled(const RomManifest& manifest, i64& outUfpsScaled) {
	if (!manifest.ufpsScaled) {
		return false;
	}
	const i64 ufpsScaled = *manifest.ufpsScaled;
	if (ufpsScaled <= 0) {
		return false;
	}
	outUfpsScaled = ufpsScaled;
	return true;
}

i64 resolveUfpsScaled(const RomManifest& manifest) {
	if (!manifest.ufpsScaled) {
		throw std::runtime_error("[EngineCore] machine.ufps is required.");
	}
	const i64 ufpsScaled = *manifest.ufpsScaled;
	if (ufpsScaled <= 0) {
		throw std::runtime_error("[EngineCore] machine.ufps must be a positive integer.");
	}
	return ufpsScaled;
}

i64 resolveVblankCycles(const RomManifest& manifest, int cyclesPerFrame) {
	if (!manifest.vblankCycles) {
		throw std::runtime_error("[EngineCore] machine.specs.vdp.vblank_cycles is required.");
	}
	const i64 cycles = *manifest.vblankCycles;
	if (cycles <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.vdp.vblank_cycles must be a positive integer.");
	}
	if (cycles > cyclesPerFrame) {
		throw std::runtime_error("[EngineCore] machine.specs.vdp.vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	return cycles;
}

i64 hzToScaledHz(f64 hz) {
	return static_cast<i64>(std::llround(hz * static_cast<f64>(HZ_SCALE)));
}

} // namespace

int calcCyclesPerFrame(i64 cpuHz, i64 refreshHzScaled) {
	const i64 wholeCycles = (cpuHz / refreshHzScaled) * HZ_SCALE;
	const i64 remainderCycles = ((cpuHz % refreshHzScaled) * HZ_SCALE) / refreshHzScaled;
	const i64 cyclesPerFrame = wholeCycles + remainderCycles;
	return static_cast<int>(cyclesPerFrame);
}

EngineCore* EngineCore::s_instance = nullptr;

EngineCore::EngineCore() {
	s_instance = this;
}

EngineCore::~EngineCore() {
	shutdown();
	if (s_instance == this) {
		s_instance = nullptr;
	}
}

EngineCore& EngineCore::instance() {
	return *s_instance;
}

EngineCore* EngineCore::instancePtr() {
	return s_instance;
}

bool EngineCore::initialize(Platform* platform) {
	if (m_state != EngineState::Uninitialized) {
		return false;
	}

	m_platform = platform;

	// Get viewport size from platform
	auto* host = platform->gameviewHost();
	Vec2 defaultViewport{ 256.0f, 212.0f };
	ViewportDimensions dims = host->getSize(defaultViewport, defaultViewport * 2.0f);

	// Create GameView with logical viewport
	m_view = std::make_unique<GameView>(host, static_cast<i32>(defaultViewport.x), static_cast<i32>(defaultViewport.y));
	m_view->viewportScale = dims.viewportScale;
	m_view->canvasScale = dims.canvasScale;
	m_viewport_scale = dims.viewportScale;
	m_canvas_scale = dims.canvasScale;

	// Subscribe to resize events
	m_resize_sub = host->onResize([this](const ViewportDimensions& dims) {
		m_viewport_scale = dims.viewportScale;
		m_canvas_scale = dims.canvasScale;
		if (m_view) {
			m_view->configureRenderTargets(nullptr, nullptr, nullptr, &m_viewport_scale, &m_canvas_scale);
		}
	});

	// Get backend from platform (SoftwareBackend for libretro)
	if (host) {
		auto backend = host->createBackend();
		if (backend) {
			m_view->setBackend(std::move(backend));
		}
	}
	m_view->bind();

	// Update view with initial size (after backend is set)
	m_view->configureRenderTargets(nullptr, nullptr, nullptr, &m_viewport_scale, &m_canvas_scale);

	m_texture_manager = std::make_unique<TextureManager>(m_view->backend());
	m_texture_manager->bind();
	if (m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

	Input::instance().initialize();
	m_sound_master = std::make_unique<SoundMaster>();
	registry().registerObject(m_sound_master.get());

	m_state = EngineState::Initialized;
	return true;
}

void EngineCore::shutdown() {
	if (m_state == EngineState::Uninitialized) {
		return;
	}

	stop();
	unloadRom();

	if (m_texture_manager) {
		m_texture_manager->dispose();
		m_texture_manager.reset();
	}

	// Dispose view
	if (m_view) {
		m_view->dispose();
		m_view.reset();
	}

	// Clear registry (keeps persistent objects)
	m_sound_master->dispose();
	registry().deregister(m_sound_master.get(), true);
	m_sound_master.reset();
	registry().clear();

	m_platform = nullptr;
	m_state = EngineState::Uninitialized;
}

void EngineCore::start() {
	if (m_state == EngineState::Initialized || m_state == EngineState::Stopped) {
		m_state = EngineState::Running;
		m_cycleCarry = 0;
		m_lastGrantedBaseBudget = 0;
	}
}

void EngineCore::pause() {
	if (m_state == EngineState::Running) {
		m_state = EngineState::Paused;
	}
}

void EngineCore::resume() {
	if (m_state == EngineState::Paused) {
		m_state = EngineState::Running;
		m_cycleCarry = 0;
		m_lastGrantedBaseBudget = 0;
	}
}

void EngineCore::stop() {
	if (m_state == EngineState::Running || m_state == EngineState::Paused) {
		m_state = EngineState::Stopped;
	}
}

void EngineCore::setUfps(f64 ufps) {
	setUfpsScaled(hzToScaledHz(ufps));
}

void EngineCore::setUfpsScaled(i64 ufpsScaled) {
	if (ufpsScaled <= HZ_SCALE) {
		throw std::runtime_error("[EngineCore] ufps must be greater than 1.");
	}
	m_ufps_scaled = ufpsScaled;
	m_update_interval_ms = (1000.0 * static_cast<f64>(HZ_SCALE)) / static_cast<f64>(m_ufps_scaled);
}

void EngineCore::applyRuntimeCycleBudget(Runtime& runtime) {
	const int cycleBudget = calcCyclesPerFrame(runtime.cpuHz(), m_ufps_scaled);
	runtime.setCycleBudgetPerFrame(cycleBudget);
}

void EngineCore::tick(f64 deltaTime) {
	if (m_state != EngineState::Running) {
		return;
	}

	const auto tickStart = std::chrono::steady_clock::now();
	// PERF LOGS DISABLED
	// if (!m_debugTickReportInitialized) {
	// 	m_debugTickReportInitialized = true;
	// 	m_debugTickReportAt = tickStart;
	// }
	// m_debugTickHostFrames += 1;

	const double hostDeltaMs = std::min(deltaTime * 1000.0, MAX_FRAME_DELTA_MS);
	const double hostDeltaSeconds = hostDeltaMs / 1000.0;
	m_delta_time = hostDeltaSeconds;
	m_total_time += hostDeltaSeconds;
	m_frame_count++;

	// Calculate FPS
	if (hostDeltaSeconds > 0.0) {
		m_fps = 1.0 / hostDeltaSeconds;
	}

	const auto inputStart = std::chrono::steady_clock::now();
	Input::instance().pollInput();
	const auto inputEnd = std::chrono::steady_clock::now();
	m_last_tick_timing.inputMs = to_ms(inputEnd - inputStart);

	m_last_tick_timing.runtimeIdeInputMs = 0.0;
	m_last_tick_timing.runtimeTerminalInputMs = 0.0;
	m_last_tick_timing.runtimeUpdateMs = 0.0;
	m_last_tick_timing.runtimeIdeMs = 0.0;
	m_last_tick_timing.runtimeTerminalMs = 0.0;
	// TODO: THIS IS UGLY AS SHIT BECAUSE IT DOESN'T USE THE TS-VERSION'S ECSYSTEMS!!
	if (Runtime::hasInstance()) {
		Runtime& runtime = Runtime::instance();
		auto ideInputStart = std::chrono::steady_clock::now();
		runtime.tickIdeInput();
		auto ideInputEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.runtimeIdeInputMs = to_ms(ideInputEnd - ideInputStart);

		auto terminalInputStart = std::chrono::steady_clock::now();
		runtime.tickTerminalInput();
		auto terminalInputEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.runtimeTerminalInputMs = to_ms(terminalInputEnd - terminalInputStart);

		m_accumulated_time = clamp(m_accumulated_time + hostDeltaMs, 0.0, m_update_interval_ms * MAX_SUBSTEPS);
		int slicesProcessed = 0;
		bool presentQueued = false;
		const double fixedDeltaSeconds = m_update_interval_ms / 1000.0;
		auto updateStart = std::chrono::steady_clock::now();
		const int baseBudget = calcCyclesPerFrame(runtime.cpuHz(), m_ufps_scaled);
		const int slicesAvailable = std::min(static_cast<int>(m_accumulated_time / m_update_interval_ms), MAX_SUBSTEPS);
		// Only advance input edge state when simulation budget is actually consumed.
		// Advancing it on frames without runtime progress would clear justpressed too early and can make
		// first-press events disappear or double-fire depending on host slowdown timing.
		// Also keep it outside the inner tick loop: slicesAvailable may contain multiple sim ticks for one host frame.
		if (slicesAvailable > 0) {
			Input::instance().beginFrame();
		}
		for (; slicesProcessed < slicesAvailable;) {
			const bool tickActive = runtime.hasActiveTick();
			const int carryBudget = tickActive ? 0 : (m_cycleCarry > 0 ? static_cast<int>(m_cycleCarry) : 0);
			if (carryBudget != 0) {
				m_cycleCarry = 0;
			}
			runtime.grantCycleBudget(baseBudget, carryBudget);
			m_lastGrantedBaseBudget = baseBudget;
			m_delta_time = fixedDeltaSeconds;
			runtime.tickUpdate();
			runtime.tickDraw();
			i64 completionSequence = 0;
			int remaining = 0;
			slicesProcessed += 1;
			if (runtime.consumeLastTickCompletion(completionSequence, remaining)) {
				(void)completionSequence;
				m_cycleCarry = remaining > baseBudget ? baseBudget : remaining;
				presentQueued = true;
				// Keep the completed frame stable for this host present; continue next frame on the next host tick.
				break;
			}
		}
		if (slicesProcessed > 0) {
			m_accumulated_time = std::max(m_accumulated_time - static_cast<double>(slicesProcessed) * m_update_interval_ms, 0.0);
		}
		if (presentQueued) {
			m_presentation_pending = true;
		}
		auto updateEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.runtimeUpdateMs = to_ms(updateEnd - updateStart);

		auto ideStart = std::chrono::steady_clock::now();
		runtime.tickIDE();
		auto ideEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.runtimeIdeMs = to_ms(ideEnd - ideStart);

		auto terminalStart = std::chrono::steady_clock::now();
		runtime.tickTerminalMode();
		auto terminalEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.runtimeTerminalMs = to_ms(terminalEnd - terminalStart);
		// PERF LOGS DISABLED
		// const i64 updateTotal = runtime.updateCountTotal();
		// if (m_debugLastUpdateCountTotal == 0) {
		// 	m_debugLastUpdateCountTotal = updateTotal;
		// }
		// const i64 updateDelta = updateTotal - m_debugLastUpdateCountTotal;
		// m_debugLastUpdateCountTotal = updateTotal;
		// m_debugTickUpdates += static_cast<u64>(updateDelta);
	}

	// Process microtasks
	m_last_tick_timing.microtaskMs = 0.0;
	if (m_platform && m_platform->microtaskQueue()) {
		const auto microtaskStart = std::chrono::steady_clock::now();
		m_platform->microtaskQueue()->flush();
		const auto microtaskEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.microtaskMs = to_ms(microtaskEnd - microtaskStart);
	}

	if (!Runtime::hasInstance()) {
		m_presentation_pending = true;
	}
	m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
	// PERF LOGS DISABLED
	// const auto tickEnd = std::chrono::steady_clock::now();
	// const double elapsedMs = to_ms(tickEnd - m_debugTickReportAt);
	// if (elapsedMs >= 1000.0) {
	// 	m_debugTickReportAt = tickEnd;
	// 	m_debugTickHostFrames = 0;
	// 	m_debugTickUpdates = 0;
	// }
}

void EngineCore::render() {
	if (m_state != EngineState::Running && m_state != EngineState::Paused) {
		return;
	}

	const bool shouldPresent = (m_state == EngineState::Paused) || m_presentation_pending;
	if (!shouldPresent) {
		return;
	}

	const auto renderStart = std::chrono::steady_clock::now();

	// Render through GameView
	if (m_view) {
		const auto beginStart = std::chrono::steady_clock::now();
		m_view->beginFrame();
		const auto beginEnd = std::chrono::steady_clock::now();
		m_last_render_timing.beginFrameMs = to_ms(beginEnd - beginStart);

		// If no ROM loaded, draw a test pattern
		if (!m_rom_loaded) {
			const auto testStart = std::chrono::steady_clock::now();
			renderTestPattern();
			const auto testEnd = std::chrono::steady_clock::now();
			m_last_render_timing.testPatternMs = to_ms(testEnd - testStart);
		} else {
			m_last_render_timing.testPatternMs = 0.0;
		}

			m_last_render_timing.runtimeDrawMs = 0.0;
			m_last_render_timing.runtimeIdeDrawMs = 0.0;
			m_last_render_timing.runtimeTerminalDrawMs = 0.0;
			if (Runtime::hasInstance()) {
				Runtime& runtime = Runtime::instance();
				auto ideDrawStart = std::chrono::steady_clock::now();
				runtime.tickIDEDraw();
				auto ideDrawEnd = std::chrono::steady_clock::now();
				m_last_render_timing.runtimeIdeDrawMs = to_ms(ideDrawEnd - ideDrawStart);

				auto terminalDrawStart = std::chrono::steady_clock::now();
				runtime.tickTerminalModeDraw();
				auto terminalDrawEnd = std::chrono::steady_clock::now();
				m_last_render_timing.runtimeTerminalDrawMs = to_ms(terminalDrawEnd - terminalDrawStart);
			}

		const auto drawGameStart = std::chrono::steady_clock::now();
		m_view->drawGame();
		const auto drawGameEnd = std::chrono::steady_clock::now();
		m_last_render_timing.drawGameMs = to_ms(drawGameEnd - drawGameStart);

		const auto endStart = std::chrono::steady_clock::now();
		m_view->endFrame();
		const auto endEnd = std::chrono::steady_clock::now();
		m_last_render_timing.endFrameMs = to_ms(endEnd - endStart);
	}

	m_presentation_pending = false;
	m_last_render_timing.totalMs = to_ms(std::chrono::steady_clock::now() - renderStart);
}

void EngineCore::refreshRenderAssets() {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}
	if (!m_view || !m_view->backend() || !m_texture_manager) {
		return;
	}
	auto* backend = m_view->backend();
	if (!backend->readyForTextureUpload()) {
		return;
	}
	m_view->initializeDefaultTextures();
	if (Runtime::hasInstance()) {
		Runtime::instance().restoreVramSlotTextures();
	}
}

	void EngineCore::log(LogLevel level, const char* fmt, ...) {
		va_list args;
		va_start(args, fmt);
		va_list args_copy;
		va_copy(args_copy, args);

		char stack_buffer[2048];
		const int written = vsnprintf(stack_buffer, sizeof(stack_buffer), fmt, args);
		va_end(args);

		if (written >= 0 && static_cast<size_t>(written) < sizeof(stack_buffer)) {
			va_end(args_copy);
			m_platform->log(level, std::string_view(stack_buffer, static_cast<size_t>(written)));
			return;
		}

		std::string message;
		if (written < 0) {
			message = "EngineCore::log: formatting error";
		} else {
			message.resize(static_cast<size_t>(written) + 1);
			vsnprintf(message.data(), message.size(), fmt, args_copy);
			message.resize(static_cast<size_t>(written));
		}
		va_end(args_copy);
		m_platform->log(level, message);
	}

bool EngineCore::action_triggered(int playerIndex, const std::string& action) {
	return Input::instance().getPlayerInput(playerIndex)->checkActionTriggered(action);
}

void EngineCore::consume_action(int playerIndex, const std::string& action) {
	Input::instance().getPlayerInput(playerIndex)->consumeAction(action);
}

void EngineCore::set_skybox_imgs(const SkyboxImageIds& ids) {
	Runtime::instance().setSkyboxImages(ids);
}

bool EngineCore::loadEngineAssets(const u8* data, size_t size) {
	m_engine_rom_owned.clear();
	m_engine_rom_data = data;
	m_engine_rom_size = size;
	return loadEngineAssetsInternal(data, size);
}

bool EngineCore::loadEngineAssetsOwned(std::vector<u8>&& data) {
	m_engine_rom_owned = std::move(data);
	m_engine_rom_data = m_engine_rom_owned.data();
	m_engine_rom_size = m_engine_rom_owned.size();
	return loadEngineAssetsInternal(m_engine_rom_data, m_engine_rom_size);
}

bool EngineCore::loadEngineAssetsInternal(const u8* data, size_t size) {
	m_engine_assets.clear();
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}

	// Load engine assets from ROM
	if (!loadAssetsFromRom(data, size, m_engine_assets, nullptr, "system")) {
		return false;
	}

	m_engine_assets_loaded = true;
	m_default_font = std::make_unique<Font>(m_engine_assets);
	m_view->default_font = m_default_font.get();
	const i64 ufpsScaled = resolveUfpsScaled(m_engine_assets.manifest);
	setUfpsScaled(ufpsScaled);
	return true;
}

bool EngineCore::loadEngineAssetsFromPath(const char* path) {
	std::ifstream file(path, std::ios::binary | std::ios::ate);
	if (!file) {
		return false;
	}

	size_t size = file.tellg();
	file.seekg(0);

	std::vector<u8> data(size);
	if (!file.read(reinterpret_cast<char*>(data.data()), size)) {
		return false;
	}

	return loadEngineAssetsOwned(std::move(data));
}

bool EngineCore::bootWithoutCart() {
	// Boot engine with only engine assets (no cartridge)
	// This runs bootrom.lua which displays the boot screen

	if (!m_engine_assets_loaded) {
		std::cerr << "[BMSX] bootWithoutCart: engine assets not loaded" << std::endl;
		return false;
	}

	// Check if engine assets have a program
	if (!m_engine_assets.hasProgram()) {
		std::cerr << "[BMSX] bootWithoutCart: no program in engine assets" << std::endl;
		return false;
	}

	std::cerr << "[BMSX] bootWithoutCart: program found, booting..." << std::endl;

	// Reference engine assets as fallback to avoid duplicating memory.
	m_assets.clear();
	m_assets.setFallback(&m_engine_assets);
	m_assets.manifest = m_engine_assets.manifest;
	m_assets.projectRootPath = m_engine_assets.projectRootPath;
	const i64 ufpsScaled = resolveUfpsScaled(m_engine_assets.manifest);
	setUfpsScaled(ufpsScaled);
	applyManifestMemorySpecs(m_assets.manifest, m_engine_assets.manifest, m_assets, m_engine_assets);
	// Don't copy programAsset - use engine_assets.programAsset directly below

	Vec2 viewportSize{
		static_cast<f32>(m_engine_assets.manifest.viewportWidth),
		static_cast<f32>(m_engine_assets.manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &m_viewport_scale, &m_canvas_scale);

	// Boot the runtime with the engine's system program
	if (m_engine_assets.programAsset && m_engine_assets.programAsset->program) {
		const i64 cpuHz = resolveCpuHz(m_engine_assets.manifest);
		const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(m_engine_assets.manifest);
		const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(m_engine_assets.manifest);
		const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(m_engine_assets.manifest);
		const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
		const i64 vblankCycles = resolveVblankCycles(m_engine_assets.manifest, cycleBudget);
		// Create Runtime instance if it doesn't exist
		if (!Runtime::hasInstance()) {
			RuntimeOptions options;
			options.playerIndex = 1;
			options.viewport.x = m_engine_assets.manifest.viewportWidth;
			options.viewport.y = m_engine_assets.manifest.viewportHeight;
			options.canonicalization = m_engine_assets.manifest.canonicalization;
			options.cpuHz = cpuHz;
			options.cycleBudgetPerFrame = cycleBudget;
			options.vblankCycles = static_cast<int>(vblankCycles);
			Runtime::createInstance(options);
		}

		Runtime& runtime = Runtime::instance();
		runtime.setCpuHz(cpuHz);
		runtime.setCycleBudgetPerFrame(cycleBudget);
		runtime.setVblankCycles(static_cast<int>(vblankCycles));
		runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk);
		runtime.refreshMemoryMap();
		runtime.setProgramSource(Runtime::ProgramSource::Engine);
		runtime.setCanonicalization(m_engine_assets.manifest.canonicalization);
		runtime.buildAssetMemory(m_engine_assets, true);
		runtime.memory().sealEngineAssets();

		// Refresh audio after asset memory is ready.
		refreshAudioAssets(m_engine_assets);

		// Boot the runtime with the pre-compiled program from engine assets
		runtime.boot(*m_engine_assets.programAsset, m_engine_assets.programSymbols.get());
	}

	m_rom_loaded = true;  // Engine is running (with system program)
	start();  // Start the engine tick/render loop
	return true;
}

bool EngineCore::loadRom(const u8* data, size_t size) {
	unloadRom();
	m_cart_rom_owned.clear();
	m_cart_rom_data = data;
	m_cart_rom_size = size;
	return loadRomInternal(data, size);
}

bool EngineCore::loadRomOwned(std::vector<u8>&& data) {
	unloadRom();
	m_cart_rom_owned = std::move(data);
	m_cart_rom_data = m_cart_rom_owned.data();
	m_cart_rom_size = m_cart_rom_owned.size();
	return loadRomInternal(m_cart_rom_data, m_cart_rom_size);
}

bool EngineCore::loadRomInternal(const u8* data, size_t size) {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}

	m_assets.clear();
	if (m_engine_assets_loaded) {
		m_assets.setFallback(&m_engine_assets);
	}

	// Load cartridge assets from ROM (overwrites engine assets with same ID)
	RuntimeAssets cartAssets;
	if (!loadAssetsFromRom(data, size, cartAssets, nullptr, "cart")) {
		m_assets.clear();
		return false;
	}

	// Merge cartridge assets on top of engine assets
	for (auto& entry : cartAssets.img) {
		m_assets.img[entry.first] = std::move(entry.second);
	}
	for (auto& entry : cartAssets.audio) {
		m_assets.audio[entry.first] = std::move(entry.second);
	}
	for (auto& entry : cartAssets.model) {
		m_assets.model[entry.first] = std::move(entry.second);
	}
	for (auto& entry : cartAssets.data) {
		m_assets.data[entry.first] = std::move(entry.second);
	}
	for (auto& entry : cartAssets.lua) {
		m_assets.lua[entry.first] = std::move(entry.second);
	}
	for (auto& entry : cartAssets.audioevents) {
		m_assets.audioevents[entry.first] = std::move(entry.second);
	}
	for (auto& entry : cartAssets.atlasTextures) {
		m_assets.atlasTextures[entry.first] = std::move(entry.second);
	}

	// Program and manifest always come from cartridge
	m_assets.programAsset = std::move(cartAssets.programAsset);
	m_assets.programSymbols = std::move(cartAssets.programSymbols);
	m_assets.manifest = std::move(cartAssets.manifest);
	m_assets.projectRootPath = std::move(cartAssets.projectRootPath);
	const i64 ufpsScaled = resolveUfpsScaled(m_assets.manifest);
	setUfpsScaled(ufpsScaled);
	applyManifestMemorySpecs(m_assets.manifest, m_engine_assets.manifest, m_assets, m_engine_assets);
	i64 cpuHz = 0;
	const bool cartCpuValid = tryResolveCpuHz(m_assets.manifest, cpuHz);
	if (!cartCpuValid) {
		i64 engineUfpsScaled = 0;
		i64 engineCpuHz = 0;
		if (!m_engine_assets_loaded
			|| !tryResolveCpuHz(m_engine_assets.manifest, engineCpuHz)
			|| !tryResolveUfpsScaled(m_engine_assets.manifest, engineUfpsScaled)) {
			throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz is required.");
		}
		std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		cpuHz = engineCpuHz;
		setUfpsScaled(engineUfpsScaled);
	}
	const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
	const RomManifest& transferManifest = cartCpuValid ? m_assets.manifest : m_engine_assets.manifest;
	const i64 vblankCycles = resolveVblankCycles(transferManifest, cycleBudget);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(transferManifest);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(transferManifest);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(transferManifest);

	Vec2 viewportSize{
		static_cast<f32>(m_assets.manifest.viewportWidth),
		static_cast<f32>(m_assets.manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &m_viewport_scale, &m_canvas_scale);

	const bool hasEngineProgram = m_engine_assets_loaded
		&& m_engine_assets.programAsset
		&& m_engine_assets.programAsset->program;
	if (hasEngineProgram) {
		if (!Runtime::hasInstance()) {
			RuntimeOptions options;
			options.playerIndex = 1;
			options.viewport.x = m_assets.manifest.viewportWidth;
			options.viewport.y = m_assets.manifest.viewportHeight;
			options.canonicalization = m_engine_assets.manifest.canonicalization;
			options.cpuHz = cpuHz;
			options.cycleBudgetPerFrame = cycleBudget;
			options.vblankCycles = static_cast<int>(vblankCycles);
			Runtime::createInstance(options);
		}
		Runtime& runtime = Runtime::instance();
		runtime.setCpuHz(cpuHz);
		runtime.setCycleBudgetPerFrame(cycleBudget);
		runtime.setVblankCycles(static_cast<int>(vblankCycles));
		runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk);
		runtime.refreshMemoryMap();
		runtime.setProgramSource(Runtime::ProgramSource::Engine);
		runtime.setCanonicalization(m_engine_assets.manifest.canonicalization);
		runtime.buildAssetMemory(m_engine_assets, true);
		runtime.memory().sealEngineAssets();
		refreshAudioAssets(m_engine_assets);
		runtime.boot(*m_engine_assets.programAsset, m_engine_assets.programSymbols.get());
		runtime.resetCartBootState();
	} else {
		if (!cartCpuValid) {
			std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; cannot boot cart without BIOS." << std::endl;
			return false;
		}
		// Boot the runtime if we have a pre-compiled program
		if (m_assets.hasProgram()) {
			if (!Runtime::hasInstance()) {
				RuntimeOptions options;
				options.playerIndex = 1;
				options.viewport.x = m_assets.manifest.viewportWidth;
				options.viewport.y = m_assets.manifest.viewportHeight;
				options.canonicalization = m_assets.manifest.canonicalization;
				options.cpuHz = cpuHz;
				options.cycleBudgetPerFrame = cycleBudget;
				options.vblankCycles = static_cast<int>(vblankCycles);
				Runtime::createInstance(options);
			}
			Runtime& runtime = Runtime::instance();
			runtime.setCpuHz(cpuHz);
			runtime.setCycleBudgetPerFrame(cycleBudget);
			runtime.setVblankCycles(static_cast<int>(vblankCycles));
			runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk);
			runtime.refreshMemoryMap();
			runtime.buildAssetMemory(m_assets, false);
			refreshAudioAssets();
			bootRuntimeFromProgram();
		} else {
			if (!Runtime::hasInstance()) {
				RuntimeOptions options;
				options.playerIndex = 1;
				options.viewport.x = m_assets.manifest.viewportWidth;
				options.viewport.y = m_assets.manifest.viewportHeight;
				options.canonicalization = m_assets.manifest.canonicalization;
				options.cpuHz = cpuHz;
				options.cycleBudgetPerFrame = cycleBudget;
				options.vblankCycles = static_cast<int>(vblankCycles);
				Runtime::createInstance(options);
			}
			Runtime& runtime = Runtime::instance();
			runtime.setCpuHz(cpuHz);
			runtime.setCycleBudgetPerFrame(cycleBudget);
			runtime.setVblankCycles(static_cast<int>(vblankCycles));
			runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk);
			runtime.refreshMemoryMap();
			runtime.buildAssetMemory(m_assets, false);
			refreshAudioAssets();
		}
	}

	m_rom_loaded = true;
	return true;
}

void EngineCore::prepareLoadedRomAssets() {
	Runtime& runtime = Runtime::instance();
	runtime.buildAssetMemory(m_assets, false, Runtime::AssetBuildMode::Cart);
	refreshAudioAssets();
}

bool EngineCore::resetLoadedRom() {
	if (!m_rom_loaded) {
		return false;
	}

	if (m_sound_master) {
		m_sound_master->resetPlaybackState();
	}

	i64 cpuHz = 0;
	const bool cartCpuValid = tryResolveCpuHz(m_assets.manifest, cpuHz);
	const bool bootCartProgram = cartCpuValid && m_assets.programAsset && m_assets.programAsset->program;
	if (!bootCartProgram) {
		if (m_texture_manager) {
			m_texture_manager->clear();
		}
		if (m_view) {
			m_view->reset();
			if (m_view->backend()->readyForTextureUpload()) {
				m_view->initializeDefaultTextures();
			}
		}
	}
	if (!cartCpuValid) {
		i64 engineUfpsScaled = 0;
		if (!m_engine_assets_loaded || !tryResolveCpuHz(m_engine_assets.manifest, cpuHz)) {
			std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; cannot reset cart." << std::endl;
			return false;
		}
		std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		if (!tryResolveUfpsScaled(m_engine_assets.manifest, engineUfpsScaled)) {
			throw std::runtime_error("[EngineCore] machine.ufps is required.");
		}
		setUfpsScaled(engineUfpsScaled);
	} else {
		const i64 ufpsScaled = resolveUfpsScaled(m_assets.manifest);
		setUfpsScaled(ufpsScaled);
	}
	const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
	const RomManifest& transferManifest = cartCpuValid ? m_assets.manifest : m_engine_assets.manifest;
	const i64 vblankCycles = resolveVblankCycles(transferManifest, cycleBudget);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(transferManifest);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(transferManifest);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(transferManifest);

	if (bootCartProgram) {
		Runtime& runtime = Runtime::instance();
		runtime.setCpuHz(cpuHz);
		runtime.setCycleBudgetPerFrame(cycleBudget);
		runtime.setVblankCycles(static_cast<int>(vblankCycles));
		runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk);
		runtime.refreshMemoryMap();
		runtime.buildAssetMemory(m_assets, false, Runtime::AssetBuildMode::Cart);
		refreshAudioAssets();
		bootRuntimeFromProgram();
		return true;
	}

	if (m_engine_assets.programAsset && m_engine_assets.programAsset->program) {
		if (!Runtime::hasInstance()) {
			RuntimeOptions options;
			options.playerIndex = 1;
			options.viewport.x = m_engine_assets.manifest.viewportWidth;
			options.viewport.y = m_engine_assets.manifest.viewportHeight;
			options.canonicalization = m_engine_assets.manifest.canonicalization;
			options.cpuHz = cpuHz;
			options.cycleBudgetPerFrame = cycleBudget;
			options.vblankCycles = static_cast<int>(vblankCycles);
			Runtime::createInstance(options);
		}
		Runtime& runtime = Runtime::instance();
		runtime.setCpuHz(cpuHz);
		runtime.setCycleBudgetPerFrame(cycleBudget);
		runtime.setVblankCycles(static_cast<int>(vblankCycles));
		runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk);
		runtime.refreshMemoryMap();
		runtime.setProgramSource(Runtime::ProgramSource::Engine);
		runtime.setCanonicalization(m_engine_assets.manifest.canonicalization);
		runtime.buildAssetMemory(m_engine_assets, true);
		runtime.memory().sealEngineAssets();
		refreshAudioAssets(m_engine_assets);
		runtime.boot(*m_engine_assets.programAsset, m_engine_assets.programSymbols.get());
		return true;
	}

	return false;
}

void EngineCore::unloadRom() {
	if (m_rom_loaded) {
		m_assets.clear();
		m_linked_program.reset();
		m_linked_program_symbols.reset();
		m_cart_rom_owned.clear();
		m_cart_rom_data = nullptr;
		m_cart_rom_size = 0;
		if (m_texture_manager) {
			m_texture_manager->clear();
		}
		m_sound_master->resetPlaybackState();
		registry().clear();
		m_rom_loaded = false;
	}
}

void EngineCore::renderTestPattern() {
	// Draw a simple test pattern to verify rendering works
	// This is shown when no ROM is loaded

	f32 t = static_cast<f32>(m_total_time);
	i32 w = static_cast<i32>(m_view->viewportSize.x);
	i32 h = static_cast<i32>(m_view->viewportSize.y);

	// Background gradient using filled rects
	for (i32 y = 0; y < h; y += 8) {
		f32 intensity = static_cast<f32>(y) / static_cast<f32>(h);
		Color bgColor{0.1f, 0.1f * intensity, 0.2f + 0.1f * intensity, 1.0f};
		m_view->fillRectangle({0.0f, static_cast<f32>(y), static_cast<f32>(w), static_cast<f32>(y + 8)}, bgColor);
	}

	// Bouncing box
	f32 boxX = (w / 2.0f) + std::sin(t * 2.0f) * (w / 3.0f);
	f32 boxY = (h / 2.0f) + std::cos(t * 1.5f) * (h / 4.0f);
	f32 boxSize = 32.0f + std::sin(t * 3.0f) * 8.0f;

	// Box shadow
	m_view->fillRectangle(
		{boxX - boxSize/2 + 4, boxY - boxSize/2 + 4, boxX + boxSize/2 + 4, boxY + boxSize/2 + 4},
		{0.0f, 0.0f, 0.0f, 0.5f}
	);

	// Main box (cycling colors)
	Color boxColor{
		0.5f + 0.5f * std::sin(t * 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 4.0f),
		1.0f
	};
	m_view->fillRectangle(
		{boxX - boxSize/2, boxY - boxSize/2, boxX + boxSize/2, boxY + boxSize/2},
		boxColor
	);

	// Box outline
	m_view->drawRectangle(
		{boxX - boxSize/2, boxY - boxSize/2, boxX + boxSize/2, boxY + boxSize/2},
		Color::white()
	);

	// Corner markers
	f32 cornerSize = 16.0f;
	m_view->fillRectangle({0, 0, cornerSize, cornerSize}, Color::red());
	m_view->fillRectangle({static_cast<f32>(w) - cornerSize, 0, static_cast<f32>(w), cornerSize}, Color::green());
	m_view->fillRectangle({0, static_cast<f32>(h) - cornerSize, cornerSize, static_cast<f32>(h)}, Color::blue());
	m_view->fillRectangle({static_cast<f32>(w) - cornerSize, static_cast<f32>(h) - cornerSize, static_cast<f32>(w), static_cast<f32>(h)}, {1.0f, 1.0f, 0.0f, 1.0f});

	// Draw some lines
	for (int i = 0; i < 8; i++) {
		f32 angle = t + i * 0.8f;
		f32 cx = w / 2.0f;
		f32 cy = h / 2.0f;
		f32 len = 40.0f + 20.0f * std::sin(t * 2.0f + i);
		Color lineColor{1.0f, 1.0f, 1.0f, 0.3f + 0.2f * std::sin(t + i)};
		m_view->drawLine(
			static_cast<i32>(cx),
			static_cast<i32>(cy),
			static_cast<i32>(cx + std::cos(angle) * len),
			static_cast<i32>(cy + std::sin(angle) * len),
			lineColor
		);
	}

	// "BMSX" text position indicator (since we don't have font rendering yet)
	f32 textY = 20.0f;
	f32 textX = 10.0f;
	// Draw placeholder rectangles for "BMSX" letters
	for (int i = 0; i < 4; i++) {
		m_view->fillRectangle(
			{textX + i * 14.0f, textY, textX + i * 14.0f + 10.0f, textY + 12.0f},
			Color::white()
		);
	}
}

void EngineCore::bootRuntimeFromProgram() {
	// Get the pre-compiled program from assets
	if (!m_assets.programAsset || !m_assets.programAsset->program) {
		return;
	}
	m_linked_program.reset();
	m_linked_program_symbols.reset();
	const i64 cpuHz = resolveCpuHz(m_assets.manifest);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(m_assets.manifest);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(m_assets.manifest);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(m_assets.manifest);
	const i64 ufpsScaled = resolveUfpsScaled(m_assets.manifest);
	setUfpsScaled(ufpsScaled);
	const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
	const i64 vblankCycles = resolveVblankCycles(m_assets.manifest, cycleBudget);

	// Create Runtime instance if it doesn't exist
	if (!Runtime::hasInstance()) {
		RuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = m_assets.manifest.viewportWidth;
		options.viewport.y = m_assets.manifest.viewportHeight;
		options.canonicalization = m_assets.manifest.canonicalization;
		options.cpuHz = cpuHz;
		options.cycleBudgetPerFrame = cycleBudget;
		options.vblankCycles = static_cast<int>(vblankCycles);
		Runtime::createInstance(options);
	}

	// Boot the runtime with the pre-compiled program
	Runtime& runtime = Runtime::instance();
	runtime.setCpuHz(cpuHz);
	runtime.setCycleBudgetPerFrame(cycleBudget);
	runtime.setVblankCycles(static_cast<int>(vblankCycles));
	runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Cart);
	runtime.setCanonicalization(m_assets.manifest.canonicalization);
	if (m_engine_assets_loaded && m_engine_assets.programAsset && m_engine_assets.programAsset->program) {
		auto linked = linkProgramAssets(
			*m_engine_assets.programAsset,
			m_engine_assets.programSymbols.get(),
			*m_assets.programAsset,
			m_assets.programSymbols.get()
		);
		m_linked_program = std::move(linked.program);
	m_linked_program_symbols = std::move(linked.metadata);
	runtime.boot(*m_linked_program, m_linked_program_symbols.get());
		return;
	}
	runtime.boot(*m_assets.programAsset, m_assets.programSymbols.get());
}

void EngineCore::refreshAudioAssets() {
	refreshAudioAssets(m_assets);
}

void EngineCore::refreshAudioAssets(const RuntimeAssets& assets) {
	const f32 volume = m_sound_master->masterVolume();
	auto audioResolver = [this, &assets](const AssetId& id) -> AudioDataView {
		Runtime& runtime = Runtime::instance();
		if (runtime.memory().hasAsset(id)) {
			const auto& entry = runtime.memory().getAssetEntry(id);
			if (entry.type == Memory::AssetType::Audio && entry.baseSize > 0) {
				return AudioDataView{ runtime.memory().getAudioData(entry), entry.frames };
			}
		}
		const AudioAsset* asset = assets.getAudio(id);
		if (!asset) {
			throw BMSX_RUNTIME_ERROR("Audio asset not found: " + id);
		}
		if (!asset->bytes.empty()) {
			return AudioDataView{ asset->bytes.data() + asset->dataOffset, asset->frames };
		}
		const std::string payloadId = asset->rom.payloadId.value();
		RomView view{};
		if (payloadId == "system") {
			view = engineRomView();
		} else if (payloadId == "cart") {
			view = cartRomView();
		} else {
			throw BMSX_RUNTIME_ERROR("Unsupported audio payload id: " + payloadId);
		}
		const i32 start = asset->rom.start.value();
		const u8* wavBase = view.data + static_cast<size_t>(start);
		return AudioDataView{ wavBase + asset->dataOffset, asset->frames };
	};
	m_sound_master->init(assets, volume, audioResolver);
	const std::optional<int> maxSfx = assets.manifest.maxVoicesSfx
		? std::optional<int>(static_cast<int>(*assets.manifest.maxVoicesSfx))
		: std::nullopt;
	const std::optional<int> maxMusic = assets.manifest.maxVoicesMusic
		? std::optional<int>(static_cast<int>(*assets.manifest.maxVoicesMusic))
		: std::nullopt;
	const std::optional<int> maxUi = assets.manifest.maxVoicesUi
		? std::optional<int>(static_cast<int>(*assets.manifest.maxVoicesUi))
		: std::nullopt;
	m_sound_master->setMaxVoicesByType(maxSfx, maxMusic, maxUi);
}

} // namespace bmsx
