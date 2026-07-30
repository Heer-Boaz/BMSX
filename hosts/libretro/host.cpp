/*
 * host.cpp - BMSX libretro host implementation
 */

#include "host.h"
#include "audio_output.h"
#include "common/endian.h"
#include "common/primitives.h"
#include "render/backend/pass/library.h"
#include "render/video_presenter.h"
#include "mem_snapshot.h"
#include "spec/bmsx/model.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#endif
#include <cstring>
#include <cstdarg>
#include <algorithm>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#if defined(__GLIBC__)
#include <malloc.h>
#endif

namespace bmsx {
namespace {
constexpr double kFrameSpikeMultiplier = 1.2;
constexpr const char* kReleaseSystemRomName = "bmsx-bios.rom";
constexpr const char* kDebugSystemRomName = "bmsx-bios.debug.rom";
constexpr const char* kDebugRomSuffix = ".debug.rom";
constexpr u32 kSaveStateMagic = 0x31534d42u;
constexpr size_t kSaveStateHeaderBytes = 8u;
constexpr size_t kSaveStateBasePayloadCapacityBytes = 0x01000000u;

size_t saveStatePayloadCapacityBytes(const Runtime& runtime) {
	return kSaveStateBasePayloadCapacityBytes
		+ runtime.machine.cartridgeController.ramByteCount();
}

size_t saveStateEnvelopeBytes(const Runtime& runtime) {
	return kSaveStateHeaderBytes + saveStatePayloadCapacityBytes(runtime);
}

void appendPathSeparator(std::string& path) {
	const char last = path.back();
	if (last != '/' && last != '\\') {
		path.push_back('/');
	}
}

std::string appendPathSegment(std::string path, const char* segment) {
	if (path.empty()) {
		return {};
	}
	appendPathSeparator(path);
	path.append(segment);
	return path;
}

std::string buildSystemRomPath(const std::string& directory, const char* fileName) {
	return appendPathSegment(directory, fileName);
}

std::string buildSystemRomPathInSubdir(const std::string& directory, const char* subdir, const char* fileName) {
	if (directory.empty()) {
		return {};
	}
	return buildSystemRomPath(appendPathSegment(directory, subdir), fileName);
}

bool hasSuffix(const std::string& value, const char* suffix) {
	const size_t suffixLength = std::strlen(suffix);
	return value.size() >= suffixLength && value.compare(value.size() - suffixLength, suffixLength, suffix) == 0;
}

bool isDebugRomPath(const char* path) {
	return path != nullptr && hasSuffix(path, kDebugRomSuffix);
}

void appendUniquePath(std::vector<std::string>& paths, std::string path) {
	if (path.empty()) {
		return;
	}
	if (std::find(paths.begin(), paths.end(), path) == paths.end()) {
		paths.push_back(std::move(path));
	}
}

void appendSystemRomCandidateSet(std::vector<std::string>& paths, const std::string& directory, const char* fileName, bool includeSubdirs) {
	appendUniquePath(paths, buildSystemRomPath(directory, fileName));
	if (includeSubdirs) {
		appendUniquePath(paths, buildSystemRomPathInSubdir(directory, "BMSX", fileName));
		appendUniquePath(paths, buildSystemRomPathInSubdir(directory, "bmsx", fileName));
	}
}

void appendSystemRomCandidates(std::vector<std::string>& paths, const std::string& directory, bool preferDebug, bool includeSubdirs) {
	const char* primary = preferDebug ? kDebugSystemRomName : kReleaseSystemRomName;
	const char* fallback = preferDebug ? kReleaseSystemRomName : kDebugSystemRomName;
	appendSystemRomCandidateSet(paths, directory, primary, includeSubdirs);
	appendSystemRomCandidateSet(paths, directory, fallback, includeSubdirs);
}
}

/* ============================================================================
 * LibretroHost implementation
 * ============================================================================ */

LibretroHost::LibretroHost(
	const MachineModelSpec& machineModel,
	LibretroInput& input,
	LibretroAudioOutput& audioOutput,
	VideoPresenter& videoPresenter,
	retro_environment_t environment,
	void (*logCallback)(enum retro_log_level, const char*, ...),
	std::string_view systemDirectory)
	: m_environ_cb(environment)
	, m_log_cb(logCallback)
	, m_system_dir(systemDirectory)
	, m_machine_model(machineModel)
	, m_input(input)
	, m_audio_output(audioOutput)
	, m_video_presenter(videoPresenter)
	, m_frame_time_sec(static_cast<double>(HZ_SCALE) / static_cast<double>(GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED))
{
	log(RETRO_LOG_INFO, "[BMSX] Host initialized\n");
}

LibretroHost::~LibretroHost() {
	unloadRom();

	m_runtime.reset();

	log(RETRO_LOG_INFO, "[BMSX] Host destroyed\n");
}

void LibretroHost::onContextReset() {
#if BMSX_ENABLE_GLES2
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: begin\n");
	auto* presenter = &m_video_presenter;
	auto* backend = &static_cast<OpenGLES2Backend&>(presenter->backend());
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: backend reset\n");
	backend->resizePresentationTarget(
		static_cast<i32>(presenter->viewportSize.x),
		static_cast<i32>(presenter->viewportSize.y));
	backend->onContextReset();

	log(RETRO_LOG_INFO, "[BMSX] onContextReset: rebuild render graph\n");
	presenter->installRenderPipeline(
		std::make_unique<RenderPassLibrary>(backend, presenter));
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: refresh render surfaces\n");
	m_video_presenter.initializeDefaultTextures();
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: done\n");
#else
	throw BMSX_RUNTIME_ERROR("[LibretroHost] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroHost::onContextDestroy() {
#if BMSX_ENABLE_GLES2
	auto* presenter = &m_video_presenter;
	auto* backend = &static_cast<OpenGLES2Backend&>(presenter->backend());
	backend->captureGxGpuVramSnapshot(m_runtime->machine.gxGpu);
	presenter->releaseRenderPipeline();
	presenter->clearTextures();
	backend->onContextDestroy();
#else
	throw BMSX_RUNTIME_ERROR("[LibretroHost] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroHost::onContextLost() {
#if BMSX_ENABLE_GLES2
	auto* presenter = &m_video_presenter;
	auto* backend = &static_cast<OpenGLES2Backend&>(presenter->backend());
	// Retire the generation before owners release handles: the replacement context may reuse the same numeric GL names.
	backend->onContextLost();
	presenter->releaseRenderPipeline();
	presenter->clearTextures();
#else
	throw BMSX_RUNTIME_ERROR("[LibretroHost] OpenGLES2 backend disabled at compile time.");
#endif
}

bool LibretroHost::loadRom(const uint8_t* data, size_t size) {
	std::array<std::vector<uint8_t>, CARTRIDGE_SLOT_COUNT> slots;
	slots[0].resize(size);
	std::memcpy(slots[0].data(), data, size);
	return loadCartridgeSlotsOwned(std::move(slots));
}

bool LibretroHost::loadCartridgeSlotsOwned(std::array<std::vector<uint8_t>, CARTRIDGE_SLOT_COUNT>&& data) {
	if (m_system_rom_image.bytes.empty()) {
		log(RETRO_LOG_ERROR, "[BMSX] Cartridge load requires a system ROM\n");
		return false;
	}
	unloadRom();
	size_t totalSize = 0;
	for (const std::vector<uint8_t>& slot : data) {
		totalSize += slot.size();
	}
	m_cartridge_rom_owned = std::move(data);
	std::array<std::span<const u8>, CARTRIDGE_SLOT_COUNT> slots;
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const std::vector<u8>& slot = m_cartridge_rom_owned[slotIndex];
		slots[slotIndex] = std::span<const u8>(slot.data(), slot.size());
	}
	{
		const std::string line = memSnapshotLine("libretro:before_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}

	startCartridgeSlots(slots);
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	{
		const std::string line = memSnapshotLine("libretro:after_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}
	log(RETRO_LOG_INFO, "Cartridge slots loaded (%zu bytes)\n", totalSize);
	return true;
}

bool LibretroHost::loadSystemRom(const char* romPath) {
	unloadRom();
	releaseSystemRomMedia();
	std::string pathStr(romPath);
	size_t lastSlash = pathStr.find_last_of("/\\");
	std::string directory = (lastSlash != std::string::npos) ? pathStr.substr(0, lastSlash + 1) : "";
	const bool preferDebug = isDebugRomPath(romPath);
	std::vector<std::string> systemRomPaths;
	appendSystemRomCandidates(systemRomPaths, directory, preferDebug, false);
	if (!m_system_dir.empty()) {
		appendSystemRomCandidates(systemRomPaths, m_system_dir, preferDebug, true);
	}

	for (const auto& path : systemRomPaths) {
		if (!path.empty() && loadSystemRomFromFile(path)) {
			return true;
		}
	}
	log(RETRO_LOG_ERROR, "[BMSX] No system ROM found\n");
	return false;
}

bool LibretroHost::loadRomFromPath(const char* path) {
	return loadCartridgeSlotsFromPaths({ std::string(path), std::string{} });
}

bool LibretroHost::loadCartridgeSlotsFromPaths(const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths) {
	if (!loadSystemRom(paths[0].c_str())) {
		return false;
	}
	{
		const std::string line = memSnapshotLine("libretro:before_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}

	std::array<std::span<const u8>, CARTRIDGE_SLOT_COUNT> slots;
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (paths[slotIndex].empty()) {
			continue;
		}
		MmapFile& file = m_cartridge_rom_files[slotIndex];
		if (!file.open(paths[slotIndex])) {
			log(RETRO_LOG_ERROR, "Failed to map cartridge slot %u\n", slotIndex);
			return false;
		}
		slots[slotIndex] = std::span<const u8>(file.data(), file.size());
	}
	startCartridgeSlots(slots);
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	{
		const std::string line = memSnapshotLine("libretro:after_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}
	log(RETRO_LOG_INFO, "Cartridge slot files loaded\n");
	return true;
}

bool LibretroHost::loadEmptyCart() {
	unloadRom();
	releaseSystemRomMedia();

	// Try to load system ROM from dist directory (default location)
	// TODO: Make this configurable via core options
	std::vector<std::string> systemRomPaths;
	if (!m_system_dir.empty()) {
		appendSystemRomCandidates(systemRomPaths, m_system_dir, true, true);
	}
	appendSystemRomCandidates(systemRomPaths, "dist", true, false);
	appendSystemRomCandidates(systemRomPaths, ".", true, false);
	appendSystemRomCandidates(systemRomPaths, "..", true, false);

	bool systemRomLoaded = false;
	for (const auto& path : systemRomPaths) {
		if (loadSystemRomFromFile(path)) {
			systemRomLoaded = true;
			break;
		}
	}

	if (!systemRomLoaded) {
		log(RETRO_LOG_ERROR, "[BMSX] No system ROM found\n");
		return false;
	}

	m_cartridge_rom_images = {};
	startRuntime();
	log(RETRO_LOG_INFO, "[BMSX] Booted system ROM firmware\n");
	return true;
}

void LibretroHost::releaseSystemRomMedia() {
	m_system_rom_image = {};
	m_system_rom_file.close();
	m_system_rom_owned.clear();
}

bool LibretroHost::loadSystemRomFromFile(const std::string& path) {
	MmapFile mapped;
	if (!mapped.open(path)) {
		log(RETRO_LOG_WARN, "[BMSX] Failed to load system ROM: %s\n", path.c_str());
		return false;
	}
	const RomImage image = parseRomImage(
		mapped.data(),
		mapped.size(),
		RomImageDomain::System);
	m_system_rom_file = std::move(mapped);
	m_system_rom_image = image;
#if defined(__GLIBC__)
	malloc_trim(0);
#endif

	log(RETRO_LOG_INFO, "[BMSX] System ROM loaded from: %s\n", path.c_str());
	return true;
}

bool LibretroHost::loadSystemRomOwned(std::vector<uint8_t>&& data) {
	unloadRom();
	releaseSystemRomMedia();
	m_system_rom_owned = std::move(data);
	m_system_rom_image = parseRomImage(
		m_system_rom_owned.data(),
		m_system_rom_owned.size(),
		RomImageDomain::System);
	return true;
}

void LibretroHost::unloadRom() {
	const bool wasLoaded = m_runtime != nullptr;
	if (wasLoaded) {
		m_input.reset();
		m_host_overlay_menu.resetInputState();
		m_screen.clearPresentation();
	}
	m_runtime.reset();
	m_cartridge_rom_images = {};
	for (MmapFile& file : m_cartridge_rom_files) {
		file.close();
	}
	m_cartridge_rom_owned = {};
	if (wasLoaded) {
		log(RETRO_LOG_INFO, "[BMSX] ROM unloaded\n");
	}
}

void LibretroHost::reset() {
	if (m_runtime) {
		m_runtime->rebootSystem();
		activateLoadedRuntime(*m_runtime);
	} else if (!loadEmptyCart()) {
		log(RETRO_LOG_ERROR, "[BMSX] Reset failed: empty cart boot failed\n");
		return;
	}

	log(RETRO_LOG_INFO, "[BMSX] Game reset (runtime rebooted)\n");
}

void LibretroHost::startCartridgeSlots(
	const std::array<std::span<const u8>, CARTRIDGE_SLOT_COUNT>& slots
) {
	m_cartridge_rom_images = {};
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const std::span<const u8> slot = slots[slotIndex];
		if (!slot.empty()) {
			m_cartridge_rom_images[slotIndex] = parseRomImage(
				slot.data(),
				slot.size(),
				RomImageDomain::Cartridge);
		}
	}
	startRuntime();
}

void LibretroHost::startRuntime() {
	CartridgeSlotMediaPair cartridgeMedia{};
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const RomImage& image = m_cartridge_rom_images[slotIndex];
		if (!image.bytes.empty()) {
			cartridgeMedia[slotIndex] = CartridgeSlotMedia{
				image.bytes,
				image.header.cartridgeBoardWord,
				image.header.cartridgeRamByteCount,
				true,
			};
		}
	}
	m_runtime = std::make_unique<Runtime>(
		RuntimeOptions{
			m_system_rom_image.bytes,
			cartridgeMedia,
			m_machine_model,
		},
		m_input);
	m_runtime->resetForSystemBoot();
	m_runtime->boot();
	activateLoadedRuntime(*m_runtime);
}

void LibretroHost::activateLoadedRuntime(Runtime& runtime) {
	m_audio_output.resetPlayback();
	m_screen.reset(m_video_presenter, runtime);
	syncHostTiming(runtime);
	runtime.frameScheduler.clearQueuedTime();
	flushSystemOutput(runtime);
}

void LibretroHost::syncHostTiming(Runtime& runtime) {
	if (runtime.timing.ufpsScaled == m_host_ufps_scaled) {
		return;
	}
	m_host_ufps_scaled = runtime.timing.ufpsScaled;
	m_input.setFrameDurationMs(runtime.timing.frameDurationMs);
	m_audio_output.setEmulationFrameTimeSec(
		static_cast<f64>(HZ_SCALE) / static_cast<f64>(m_host_ufps_scaled));
}

bool LibretroHost::runFrame() {
	if (!m_runtime) return false;

	const f64 dt = m_frame_time_sec;

	// Poll input before the runtime frame loop consumes and latches
	// input for this host frame.
	m_input.poll(
		static_cast<i32>(m_video_presenter.viewportSize.x),
		static_cast<i32>(m_video_presenter.viewportSize.y),
		(m_total_time + dt) * 1000.0);

	Runtime& runtime = *m_runtime;
	bool presented = false;
	try {
		presented = runHostFrame(runtime, dt);
	} catch (const std::exception& error) {
		reportRuntimeError(runtime, error.what());
	} catch (...) {
		reportRuntimeError(runtime, "Unhandled host frame exception.");
	}
	flushSystemOutput(runtime);
	syncHostTiming(runtime);
	m_audio_output.collectFrame(runtime.machine.audioController);
	return presented;
}

i32 LibretroHost::activeExecutionDomainId() const {
	return m_runtime->machine.cpu.activeCartridgeSlot();
}

i64 LibretroHost::refreshUfpsScaled() const {
	return m_runtime->timing.ufpsScaled;
}

void LibretroHost::setPaused(bool paused) {
	if (paused == m_paused) {
		return;
	}
	m_paused = paused;
	if (paused) {
		m_screen.clearPresentation();
	} else if (m_runtime && m_runtime->isDrawPending()) {
		m_runtime->frameScheduler.clearQueuedTime();
	}
}

void LibretroHost::log(retro_log_level level, std::string_view message) {
	if (m_log_cb) {
		m_log_cb(level, "%.*s", static_cast<int>(message.size()), message.data());
	}
}

void LibretroHost::log(retro_log_level level, const char* fmt, ...) {
	if (m_log_cb) {
		va_list args;
		va_start(args, fmt);
		char buffer[1024];
		vsnprintf(buffer, sizeof(buffer), fmt, args);
		va_end(args);
		m_log_cb(level, "%s", buffer);
	}
}

size_t LibretroHost::getStateSize() const {
	if (!m_runtime) {
		return 0;
	}
	return saveStateEnvelopeBytes(*m_runtime);
}

// start fallible-boundary -- libretro serialization callbacks report failure as false after logging.
bool LibretroHost::saveState(void* data, size_t size) {
	if (!m_runtime) {
		return false;
	}
	Runtime& runtime = *m_runtime;
	const size_t envelopeBytes = saveStateEnvelopeBytes(runtime);
	if (size < envelopeBytes) {
		return false;
	}
	try {
		m_video_presenter.backend().captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		const std::vector<u8> state = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
		if (state.size() > saveStatePayloadCapacityBytes(runtime)) {
			return false;
		}
		u8* const envelope = static_cast<u8*>(data);
		writeLE32(envelope, kSaveStateMagic);
		writeLE32(envelope + 4u, static_cast<u32>(state.size()));
		std::memcpy(envelope + kSaveStateHeaderBytes, state.data(), state.size());
		std::memset(envelope + kSaveStateHeaderBytes + state.size(), 0, envelopeBytes - kSaveStateHeaderBytes - state.size());
		return true;
	}
	catch (const std::exception& error) {
		log(RETRO_LOG_ERROR, "[BMSX] Save state failed: %s\n", error.what());
		return false;
	}
}

bool LibretroHost::loadState(const void* data, size_t size) {
	if (!m_runtime) {
		return false;
	}
	Runtime& runtime = *m_runtime;
	try {
		if (size < saveStateEnvelopeBytes(runtime)) {
			return false;
		}
		const u8* const envelope = static_cast<const u8*>(data);
		if (readLE32(envelope) != kSaveStateMagic) {
			return false;
		}
		const size_t payloadBytes = readLE32(envelope + 4u);
		if (payloadBytes > saveStatePayloadCapacityBytes(runtime)) {
			return false;
		}
		applyRuntimeSaveState(
			runtime,
			decodeRuntimeSaveState(
				std::span<const u8>(
					envelope + kSaveStateHeaderBytes,
					payloadBytes
				),
				runtime.machine.memory.ramByteCount(),
				runtime.machine.gxGpu.readVramSnapshotBytes().size()
			)
		);
		m_audio_output.resetPlayback();
		return true;
	}
	catch (const std::exception& error) {
		log(RETRO_LOG_ERROR, "[BMSX] Load state failed: %s\n", error.what());
		return false;
	}
}
// end fallible-boundary

void LibretroHost::resetCheats() {
	// TODO: Clear all cheats
}

void LibretroHost::setCheat(unsigned index, bool enabled, const char* code) {
	// TODO: Parse and apply cheat code
	(void)index;
	(void)enabled;
	(void)code;
}

void* LibretroHost::getSystemRAM() {
	if (!m_runtime) {
		return nullptr;
	}
	return m_runtime->machine.memory.ramData();
}

size_t LibretroHost::getSystemRAMSize() const {
	if (!m_runtime) {
		return 0;
	}
	return m_runtime->machine.memory.ramByteCount();
}

} // namespace bmsx
