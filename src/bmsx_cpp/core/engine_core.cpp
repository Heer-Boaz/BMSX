/*
 * engine.cpp - Core engine implementation
 */

#include "engine_core.h"
#include "system_machine.h"
#include "../input/input.h"
#include "../render/texturemanager.h"
#include "../emulator/runtime.h"
#include "../emulator/program_linker.h"
#include "../emulator/font.h"
#include "../rompack/rompack.h"
#include "../emulator/memory_map.h"
#include "../render/shared/render_queues.h"
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
	ids.insert(FRAMEBUFFER_TEXTURE_KEY);
	ids.insert(FRAMEBUFFER_RENDER_TEXTURE_KEY);

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

uint32_t resolveSystemAtlasSlotBytes(const RuntimeAssets& engineAssets) {
	const std::string engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
	const ImgAsset* engineAtlas = engineAssets.getImg(engineAtlasId);
	if (!engineAtlas) {
		throw std::runtime_error("[EngineCore] Engine atlas missing from assets.");
	}
	const i32 width = engineAtlas->meta.width;
	const i32 height = engineAtlas->meta.height;
	if (width <= 0 || height <= 0) {
		throw std::runtime_error("[EngineCore] Engine atlas dimensions must be positive.");
	}
	return static_cast<uint32_t>(width) * static_cast<uint32_t>(height) * 4u;
}

MemoryMapConfig resolveMemoryMapConfig(const MachineManifest& machine, const MachineManifest& systemMachine, const RuntimeAssets& assets, const RuntimeAssets& engineAssets) {
	MemoryMapConfig config;
	if (machine.atlasSlotBytes) {
		const i32 value = *machine.atlasSlotBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] atlas_slot_bytes must be greater than 0.");
		}
		config.atlasSlotBytes = static_cast<uint32_t>(value);
	}
	if (systemMachine.engineAtlasSlotBytes) {
		const i32 value = *systemMachine.engineAtlasSlotBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] system_atlas_slot_bytes must be greater than 0.");
		}
		config.engineAtlasSlotBytes = static_cast<uint32_t>(value);
	} else {
		config.engineAtlasSlotBytes = resolveSystemAtlasSlotBytes(engineAssets);
	}
	if (machine.stagingBytes) {
		const i32 value = *machine.stagingBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] staging_bytes must be greater than 0.");
		}
		config.stagingBytes = static_cast<uint32_t>(value);
	}
	const uint32_t frameBufferWidth = static_cast<uint32_t>(machine.viewportWidth);
	const uint32_t frameBufferHeight = static_cast<uint32_t>(machine.viewportHeight);
	config.frameBufferBytes = frameBufferWidth * frameBufferHeight * 4u;
	if (machine.skyboxFaceBytes) {
		const i32 value = *machine.skyboxFaceBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] skybox_face_bytes must be greater than 0.");
		}
		config.skyboxFaceBytes = static_cast<uint32_t>(value);
	} else {
		const i32 faceSize = machine.skyboxFaceSize > 0
			? machine.skyboxFaceSize
			: SKYBOX_FACE_DEFAULT_SIZE;
		if (faceSize <= 0) {
			throw std::runtime_error("[EngineCore] skybox_face_size must be greater than 0.");
		}
		config.skyboxFaceBytes = static_cast<uint32_t>(faceSize) * static_cast<uint32_t>(faceSize) * 4u;
	}

	const uint32_t requiredAssetTableBytes = computeAssetTableBytes(engineAssets, assets);
	config.assetTableBytes = requiredAssetTableBytes;
	const uint32_t stringHandleTableBytes = config.stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
	const uint32_t requiredAssetDataBytes = computeRequiredAssetDataBytes(engineAssets, assets);
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
		throw std::runtime_error("[EngineCore] ram_bytes exceeds addressable range.");
	}
	const uint32_t minimumRamBytes = static_cast<uint32_t>(requiredRamBytes);
	if (machine.ramBytes) {
		const i32 value = *machine.ramBytes;
		if (value <= 0) {
			throw std::runtime_error("[EngineCore] ram_bytes must be greater than 0.");
		}
		const uint32_t resolved = static_cast<uint32_t>(value);
		if (resolved < minimumRamBytes) {
			throw std::runtime_error("[EngineCore] ram_bytes must be at least required size.");
		}
		config.ramBytes = resolved;
		config.assetDataBytes = resolved - static_cast<uint32_t>(fixedRamBytes);
	} else {
		config.ramBytes = minimumRamBytes;
		config.assetDataBytes = requiredAssetDataBytes;
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
		<< ", geo_scratch=" << DEFAULT_GEO_SCRATCH_SIZE
		<< ", vdp_stream=" << VDP_STREAM_BUFFER_SIZE
		<< ", vram_staging=" << config.stagingBytes
		<< ", framebuffer=" << config.frameBufferBytes
		<< ", engine_atlas_slot=" << config.engineAtlasSlotBytes
		<< ", atlas_slot=" << config.atlasSlotBytes << "x2=" << (config.atlasSlotBytes * 2u)
		<< ")." << std::endl;
	return config;
}

void applyManifestMemorySpecs(const MachineManifest& machine, const MachineManifest& systemMachine, const RuntimeAssets& assets, const RuntimeAssets& engineAssets) {
	const MemoryMapConfig config = resolveMemoryMapConfig(machine, systemMachine, assets, engineAssets);
	configureMemoryMap(config);
}

bool tryResolveCpuHz(const MachineManifest& manifest, i64& outHz) {
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

i64 resolveCpuHz(const MachineManifest& manifest) {
	if (!manifest.cpuHz) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz is required.");
	}
	const i64 hz = *manifest.cpuHz;
	if (hz <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz must be a positive integer.");
	}
	return hz;
}

i64 resolveImgDecBytesPerSec(const MachineManifest& manifest) {
	if (!manifest.imgDecBytesPerSec) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.imgdec_bytes_per_sec is required.");
	}
	const i64 value = *manifest.imgDecBytesPerSec;
	if (value <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.cpu.imgdec_bytes_per_sec must be a positive integer.");
	}
	return value;
}

i64 resolveDmaBytesPerSecIso(const MachineManifest& manifest) {
	if (!manifest.dmaBytesPerSecIso) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_iso is required.");
	}
	const i64 value = *manifest.dmaBytesPerSecIso;
	if (value <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_iso must be a positive integer.");
	}
	return value;
}

i64 resolveDmaBytesPerSecBulk(const MachineManifest& manifest) {
	if (!manifest.dmaBytesPerSecBulk) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_bulk is required.");
	}
	const i64 value = *manifest.dmaBytesPerSecBulk;
	if (value <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.dma.dma_bytes_per_sec_bulk must be a positive integer.");
	}
	return value;
}

i64 resolveVdpWorkUnitsPerSec(const MachineManifest& manifest) {
	const i64 value = manifest.vdpWorkUnitsPerSec.value_or(DEFAULT_VDP_WORK_UNITS_PER_SEC);
	if (value <= 0) {
		throw std::runtime_error("[EngineCore] machine.specs.vdp.work_units_per_sec must be a positive integer.");
	}
	return value;
}

bool tryResolveUfpsScaled(const MachineManifest& manifest, i64& outUfpsScaled) {
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

i64 resolveUfpsScaled(const MachineManifest& manifest) {
	if (!manifest.ufpsScaled) {
		throw std::runtime_error("[EngineCore] machine.ufps is required.");
	}
	const i64 ufpsScaled = *manifest.ufpsScaled;
	if (ufpsScaled <= 0) {
		throw std::runtime_error("[EngineCore] machine.ufps must be a positive integer.");
	}
	return ufpsScaled;
}

i64 hzToScaledHz(f64 hz) {
	return static_cast<i64>(std::llround(hz * static_cast<f64>(HZ_SCALE)));
}

} // namespace

i64 resolveVblankCycles(i64 cpuHz, i64 refreshHzScaled, i32 renderHeight) {
	if (cpuHz <= 0) {
		throw std::runtime_error("[EngineCore] cpuFreqHz must be a positive integer.");
	}
	if (refreshHzScaled <= 0) {
		throw std::runtime_error("[EngineCore] ufpsScaled must be a positive integer.");
	}
	if (renderHeight <= 0) {
		throw std::runtime_error("[EngineCore] renderHeight must be a positive integer.");
	}
	const i64 cycleBudgetPerFrame = calcCyclesPerFrame(cpuHz, refreshHzScaled);
	const i64 activeScanlines = cycleBudgetPerFrame / static_cast<i64>(renderHeight + 1);
	const i64 activeDisplayCycles = activeScanlines * static_cast<i64>(renderHeight);
	const i64 vblankCycles = cycleBudgetPerFrame - activeDisplayCycles;
	if (vblankCycles > cycleBudgetPerFrame) {
		throw std::runtime_error("[EngineCore] vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	if (vblankCycles <= 0) {
		throw std::runtime_error("[EngineCore] vblank_cycles must be greater than 0.");
	}
	return vblankCycles;
}

int calcCyclesPerFrame(i64 cpuHz, i64 refreshHzScaled) {
	const i64 wholeCycles = (cpuHz / refreshHzScaled) * HZ_SCALE;
	const i64 remainderCycles = ((cpuHz % refreshHzScaled) * HZ_SCALE) / refreshHzScaled;
	const i64 cyclesPerFrame = wholeCycles + remainderCycles;
	return static_cast<int>(cyclesPerFrame);
}

EngineCore* EngineCore::s_instance = nullptr;

EngineCore::EngineCore() {
	s_instance = this;
	m_active_assets = &m_engine_assets;
	m_machine_manifest = &m_engine_assets.machine;
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
	const MachineManifest& systemMachine = defaultSystemMachineManifest();
	Vec2 defaultViewport{
		static_cast<f32>(systemMachine.viewportWidth),
		static_cast<f32>(systemMachine.viewportHeight)
	};
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
	m_presentation_mode = GameView::PresentationMode::Completed;
	m_commit_presented_frame = false;
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
		// Advance input edge state only when a brand-new runtime tick starts.
		// Do not treat "slicesAvailable > 0" as permission to move the input frame:
		// during heavy slowdown the runtime can be resuming the same unfinished
		// simframe across multiple host frames, and hasActiveTick() stays true.
		// If beginFrame() runs on those continuation host frames, InputStateManager
		// clears jp/jr before gameplay gets the next simulation slice, which makes
		// justpressed appear to require extremely precise timing under slowdown.
		// The invariant is:
		// one input beginFrame() per newly-started simframe, never per host frame.
		if (slicesAvailable > 0 && !runtime.hasActiveTick()) {
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
			TickCompletion completion;
			slicesProcessed += 1;
			if (runtime.consumeLastTickCompletion(completion)) {
				m_cycleCarry = 0;
				presentQueued = true;
				m_presentation_mode = GameView::PresentationMode::Completed;
				m_commit_presented_frame = completion.visualCommitted;
				// Keep the completed frame stable for this host present; continue next frame on the next host tick.
				break;
			}
		}
		if (slicesProcessed > 0) {
			m_accumulated_time = std::max(m_accumulated_time - static_cast<double>(slicesProcessed) * m_update_interval_ms, 0.0);
		}
		if (!presentQueued && runtime.isDrawPending()) {
			m_presentation_mode = GameView::PresentationMode::Partial;
			m_commit_presented_frame = false;
		}
		if (presentQueued || runtime.isDrawPending()) {
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
		m_presentation_mode = GameView::PresentationMode::Completed;
		m_commit_presented_frame = false;
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
		const bool pausedPresent = m_state == EngineState::Paused;
		m_view->configurePresentation(pausedPresent ? GameView::PresentationMode::Completed : m_presentation_mode, pausedPresent ? false : m_commit_presented_frame);
		if (!pausedPresent && m_presentation_mode == GameView::PresentationMode::Completed && m_commit_presented_frame) {
			RenderQueues::prepareCompletedRenderQueues();
		} else if (pausedPresent || m_presentation_mode == GameView::PresentationMode::Completed) {
			RenderQueues::prepareHeldRenderQueues();
		} else {
			RenderQueues::preparePartialRenderQueues();
		}
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
	m_commit_presented_frame = false;
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

	if (!loadSystemAssetsFromRom(data, size, m_engine_assets, nullptr, "system")) {
		return false;
	}

	m_engine_assets_loaded = true;
	m_engine_assets.machine = defaultSystemMachineManifest();
	m_engine_assets.entryPoint = systemBootEntryPath();
	m_active_assets = &m_engine_assets;
	m_machine_manifest = &m_engine_assets.machine;
	m_default_font = std::make_unique<Font>(m_engine_assets);
	m_view->default_font = m_default_font.get();
	const i64 ufpsScaled = resolveUfpsScaled(m_engine_assets.machine);
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

ImgAsset* EngineCore::resolveImgAsset(const AssetId& id) {
	ImgAsset* asset = assets().getImg(id);
	if (asset) {
		return asset;
	}
	return m_engine_assets.getImg(id);
}

const ImgAsset* EngineCore::resolveImgAsset(const AssetId& id) const {
	const ImgAsset* asset = assets().getImg(id);
	if (asset) {
		return asset;
	}
	return m_engine_assets.getImg(id);
}

void EngineCore::activateEngineAssets() {
	m_active_assets = &m_engine_assets;
}

void EngineCore::activateCartAssets() {
	m_active_assets = &m_cart_assets;
}

void EngineCore::setMachineManifest(const MachineManifest& manifest) {
	m_machine_manifest = &manifest;
}

void EngineCore::configureViewForMachine(const MachineManifest& manifest) {
	Vec2 viewportSize{
		static_cast<f32>(manifest.viewportWidth),
		static_cast<f32>(manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &m_viewport_scale, &m_canvas_scale);
}

bool EngineCore::bootEngineStartupProgram(const MachineManifest& runtimeMachine, const RuntimeAssets& sizingAssets) {
	if (!m_engine_assets_loaded) {
		return false;
	}
	if (!m_engine_assets.programAsset || !m_engine_assets.programAsset->program) {
		return false;
	}

	activateEngineAssets();
	setMachineManifest(runtimeMachine);
	const i64 ufpsScaled = resolveUfpsScaled(runtimeMachine);
	setUfpsScaled(ufpsScaled);
	applyManifestMemorySpecs(runtimeMachine, m_engine_assets.machine, sizingAssets, m_engine_assets);
	configureViewForMachine(runtimeMachine);

	const i64 cpuHz = resolveCpuHz(runtimeMachine);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(runtimeMachine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(runtimeMachine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(runtimeMachine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(runtimeMachine));
	const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, m_ufps_scaled, runtimeMachine.viewportHeight);

	if (!Runtime::hasInstance()) {
		RuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = runtimeMachine.viewportWidth;
		options.viewport.y = runtimeMachine.viewportHeight;
		options.canonicalization = m_engine_assets.machine.canonicalization;
		options.cpuHz = cpuHz;
		options.cycleBudgetPerFrame = cycleBudget;
		options.vblankCycles = static_cast<int>(vblankCycles);
		options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
		Runtime::createInstance(options);
	}

	Runtime& runtime = Runtime::instance();
	runtime.setCpuHz(cpuHz);
	runtime.setCycleBudgetPerFrame(cycleBudget);
	runtime.setVblankCycles(static_cast<int>(vblankCycles));
	runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Engine);
	runtime.setCanonicalization(m_engine_assets.machine.canonicalization);
	runtime.buildAssetMemory(m_engine_assets, true);
	runtime.memory().sealEngineAssets();
	refreshAudioAssets(m_engine_assets);
	runtime.boot(*m_engine_assets.programAsset, m_engine_assets.programSymbols.get());
	runtime.resetCartBootState();
	return true;
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
	if (!bootEngineStartupProgram(m_engine_assets.machine, m_engine_assets)) {
		return false;
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

	m_cart_assets.clear();
	if (!loadCartAssetsFromRom(data, size, m_cart_assets, nullptr, "cart")) {
		return false;
	}
	m_loaded_cart_has_program = m_cart_assets.programAsset && m_cart_assets.programAsset->program;

	const MachineManifest& cartMachine = m_cart_assets.machine;
	const i64 ufpsScaled = resolveUfpsScaled(cartMachine);
	setUfpsScaled(ufpsScaled);
	i64 cpuHz = 0;
	const bool cartCpuValid = tryResolveCpuHz(cartMachine, cpuHz);
	if (!cartCpuValid) {
		i64 engineUfpsScaled = 0;
		i64 engineCpuHz = 0;
		if (!m_engine_assets_loaded
			|| !tryResolveCpuHz(m_engine_assets.machine, engineCpuHz)
			|| !tryResolveUfpsScaled(m_engine_assets.machine, engineUfpsScaled)) {
			throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz is required.");
		}
		std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		cpuHz = engineCpuHz;
		setUfpsScaled(engineUfpsScaled);
	}
	const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
	const MachineManifest& transferMachine = cartCpuValid ? cartMachine : m_engine_assets.machine;
	const i64 vblankCycles = resolveVblankCycles(cpuHz, m_ufps_scaled, transferMachine.viewportHeight);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(transferMachine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(transferMachine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(transferMachine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(transferMachine));

	configureViewForMachine(cartMachine);

	const bool hasEngineProgram = m_engine_assets_loaded
		&& m_engine_assets.programAsset
		&& m_engine_assets.programAsset->program;
	if (hasEngineProgram) {
		if (!bootEngineStartupProgram(transferMachine, m_cart_assets)) {
			return false;
		}
	} else {
		if (!cartCpuValid) {
			std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; cannot boot cart without BIOS." << std::endl;
			return false;
		}
		activateCartAssets();
		setMachineManifest(cartMachine);
		applyManifestMemorySpecs(assets().machine, m_engine_assets.machine, assets(), m_engine_assets);
		// Boot the runtime if we have a pre-compiled program
		if (assets().hasProgram()) {
			if (!Runtime::hasInstance()) {
				RuntimeOptions options;
				options.playerIndex = 1;
				options.viewport.x = assets().machine.viewportWidth;
				options.viewport.y = assets().machine.viewportHeight;
				options.canonicalization = assets().machine.canonicalization;
				options.cpuHz = cpuHz;
				options.cycleBudgetPerFrame = cycleBudget;
				options.vblankCycles = static_cast<int>(vblankCycles);
				options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
				Runtime::createInstance(options);
			}
			Runtime& runtime = Runtime::instance();
			runtime.setCpuHz(cpuHz);
			runtime.setCycleBudgetPerFrame(cycleBudget);
			runtime.setVblankCycles(static_cast<int>(vblankCycles));
			runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec);
			runtime.refreshMemoryMap();
			runtime.buildAssetMemory(assets(), false);
			refreshAudioAssets();
			bootRuntimeFromProgram();
		} else {
			if (!Runtime::hasInstance()) {
				RuntimeOptions options;
				options.playerIndex = 1;
				options.viewport.x = assets().machine.viewportWidth;
				options.viewport.y = assets().machine.viewportHeight;
				options.canonicalization = assets().machine.canonicalization;
				options.cpuHz = cpuHz;
				options.cycleBudgetPerFrame = cycleBudget;
				options.vblankCycles = static_cast<int>(vblankCycles);
				options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
				Runtime::createInstance(options);
			}
			Runtime& runtime = Runtime::instance();
			runtime.setCpuHz(cpuHz);
			runtime.setCycleBudgetPerFrame(cycleBudget);
			runtime.setVblankCycles(static_cast<int>(vblankCycles));
			runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec);
			runtime.refreshMemoryMap();
			runtime.buildAssetMemory(assets(), false);
			refreshAudioAssets();
		}
	}

	m_rom_loaded = true;
	return true;
}

void EngineCore::prepareLoadedRomAssets() {
	Runtime& runtime = Runtime::instance();
	runtime.buildAssetMemory(m_cart_assets, false, Runtime::AssetBuildMode::Cart);
	refreshAudioAssets();
}

bool EngineCore::bootLoadedCart() {
	if (!m_rom_loaded) {
		return false;
	}

	if (m_cart_rom_size == 0) {
		return false;
	}
	activateCartAssets();
	setMachineManifest(m_cart_assets.machine);

	if (!assets().programAsset || !assets().programAsset->program) {
		std::cerr << "[EngineCore] Loaded cart has no program asset." << std::endl;
		return false;
	}

	const i64 cpuHz = resolveCpuHz(assets().machine);
	const i64 ufpsScaled = resolveUfpsScaled(assets().machine);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(assets().machine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(assets().machine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(assets().machine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(assets().machine));
	setUfpsScaled(ufpsScaled);
	applyManifestMemorySpecs(assets().machine, m_engine_assets.machine, assets(), m_engine_assets);
	configureViewForMachine(assets().machine);
	const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, m_ufps_scaled, assets().machine.viewportHeight);

	if (!Runtime::hasInstance()) {
		RuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = assets().machine.viewportWidth;
		options.viewport.y = assets().machine.viewportHeight;
		options.canonicalization = assets().machine.canonicalization;
		options.cpuHz = cpuHz;
		options.cycleBudgetPerFrame = cycleBudget;
		options.vblankCycles = static_cast<int>(vblankCycles);
		options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
		Runtime::createInstance(options);
	}

	Runtime& runtime = Runtime::instance();
	runtime.setCpuHz(cpuHz);
	runtime.setCycleBudgetPerFrame(cycleBudget);
	runtime.setVblankCycles(static_cast<int>(vblankCycles));
	runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec);
	runtime.refreshMemoryMap();
	runtime.buildAssetMemory(assets(), false, Runtime::AssetBuildMode::Cart);
	refreshAudioAssets();
	bootRuntimeFromProgram();
	return true;
}

bool EngineCore::rebootLoadedRom() {
	if (!m_rom_loaded) {
		return false;
	}

	if (m_sound_master) {
		m_sound_master->resetPlaybackState();
	}
	if (m_texture_manager) {
		m_texture_manager->clear();
	}
	if (m_view) {
		m_view->reset();
		if (m_view->backend()->readyForTextureUpload()) {
			m_view->initializeDefaultTextures();
		}
	}

	const MachineManifest* runtimeMachine = &m_engine_assets.machine;
	const RuntimeAssets* sizingAssets = &m_engine_assets;
	if (m_cart_rom_size > 0 && m_cart_assets.programAsset && m_cart_assets.programAsset->program) {
		runtimeMachine = &m_cart_assets.machine;
		sizingAssets = &m_cart_assets;
	}
	return bootEngineStartupProgram(*runtimeMachine, *sizingAssets);
}

void EngineCore::unloadRom() {
	if (m_rom_loaded) {
		m_active_assets = &m_engine_assets;
		m_machine_manifest = &m_engine_assets.machine;
		m_cart_assets.clear();
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
		m_loaded_cart_has_program = false;
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
	if (!assets().programAsset || !assets().programAsset->program) {
		return;
	}
	m_linked_program.reset();
	m_linked_program_symbols.reset();
	const RuntimeAssets& activeAssets = assets();
	const i64 cpuHz = resolveCpuHz(activeAssets.machine);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(activeAssets.machine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(activeAssets.machine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(activeAssets.machine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(activeAssets.machine));
	const i64 ufpsScaled = resolveUfpsScaled(activeAssets.machine);
	setUfpsScaled(ufpsScaled);
	const int cycleBudget = calcCyclesPerFrame(cpuHz, m_ufps_scaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, m_ufps_scaled, activeAssets.machine.viewportHeight);

	// Create Runtime instance if it doesn't exist
	if (!Runtime::hasInstance()) {
		RuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = activeAssets.machine.viewportWidth;
		options.viewport.y = activeAssets.machine.viewportHeight;
		options.canonicalization = activeAssets.machine.canonicalization;
		options.cpuHz = cpuHz;
		options.cycleBudgetPerFrame = cycleBudget;
		options.vblankCycles = static_cast<int>(vblankCycles);
		options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
		Runtime::createInstance(options);
	}

	// Boot the runtime with the pre-compiled program
	Runtime& runtime = Runtime::instance();
	runtime.setCpuHz(cpuHz);
	runtime.setCycleBudgetPerFrame(cycleBudget);
	runtime.setVblankCycles(static_cast<int>(vblankCycles));
	runtime.setTransferRates(imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Cart);
	runtime.setCanonicalization(activeAssets.machine.canonicalization);
	if (m_engine_assets_loaded && m_engine_assets.programAsset && m_engine_assets.programAsset->program) {
		auto linked = linkProgramAssets(
			*m_engine_assets.programAsset,
			m_engine_assets.programSymbols.get(),
			*activeAssets.programAsset,
			activeAssets.programSymbols.get()
		);
		m_linked_program = std::move(linked.program);
		m_linked_program_symbols = std::move(linked.metadata);
		runtime.boot(*m_linked_program, m_linked_program_symbols.get());
		return;
	}
	runtime.boot(*activeAssets.programAsset, activeAssets.programSymbols.get());
}

void EngineCore::refreshAudioAssets() {
	refreshAudioAssets(assets());
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
	const MachineManifest& machineManifest = this->machineManifest();
	const std::optional<int> maxSfx = machineManifest.maxVoicesSfx
		? std::optional<int>(static_cast<int>(*machineManifest.maxVoicesSfx))
		: std::nullopt;
	const std::optional<int> maxMusic = machineManifest.maxVoicesMusic
		? std::optional<int>(static_cast<int>(*machineManifest.maxVoicesMusic))
		: std::nullopt;
	const std::optional<int> maxUi = machineManifest.maxVoicesUi
		? std::optional<int>(static_cast<int>(*machineManifest.maxVoicesUi))
		: std::nullopt;
	m_sound_master->setMaxVoicesByType(maxSfx, maxMusic, maxUi);
}

} // namespace bmsx
