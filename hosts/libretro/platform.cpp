/*
 * platform.cpp - BMSX Platform implementation for libretro
 */

#include "platform.h"
#include "core/machine_manager.h"
#include "common/endian.h"
#include "common/primitives.h"
#include "core/rom_boot_manager.h"
#include "input/gamepad_buttons.h"
#include "input/hid_keys.h"
#include "input/pointer_controls.h"
#include "render/backend/pass/library.h"
#include "render/texture_manager.h"
#include "common/mem_snapshot.h"
#include "machine/model_registry.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#endif
#include <cstring>
#include <cstdarg>
#include <algorithm>
#include <cmath>
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
constexpr size_t kAudioRefillMarginFrames = 128;
constexpr size_t kAudioRequestAheadFrames = 256;
constexpr size_t kAudioTargetMinFrames = 384;
constexpr size_t kAudioTargetMaxFrames = 4096;
constexpr size_t kAudioReserveVideoFrames = 10;
constexpr size_t kAudioReserveFrames = static_cast<size_t>(DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE * static_cast<double>(HZ_SCALE) / static_cast<double>(PAL_REFRESH_UFPS_SCALED)) * kAudioReserveVideoFrames;
constexpr const char* kReleaseSystemRomName = "bmsx-bios.rom";
constexpr const char* kDebugSystemRomName = "bmsx-bios.debug.rom";
constexpr const char* kDebugRomSuffix = ".debug.rom";
constexpr u32 kSaveStateMagic = 0x31534d42u;
constexpr size_t kSaveStateHeaderBytes = 8u;
constexpr size_t kSaveStateEnvelopeBytes = kSaveStateHeaderBytes + RUNTIME_SAVE_STATE_WIRE_CAPACITY;

constexpr std::array<i16, RETROK_LAST> makeRetroKeyHidUsages() {
	std::array<i16, RETROK_LAST> usages{};
	usages.fill(-1);
	for (unsigned key = RETROK_a; key <= RETROK_z; key += 1u) {
		usages[key] = static_cast<i16>(4u + key - RETROK_a);
	}
	for (unsigned key = RETROK_1; key <= RETROK_9; key += 1u) {
		usages[key] = static_cast<i16>(30u + key - RETROK_1);
	}
	usages[RETROK_0] = 39;
	usages[RETROK_RETURN] = HID_USAGE_ENTER;
	usages[RETROK_ESCAPE] = 41;
	usages[RETROK_BACKSPACE] = HID_USAGE_BACKSPACE;
	usages[RETROK_TAB] = 43;
	usages[RETROK_SPACE] = 44;
	usages[RETROK_MINUS] = 45;
	usages[RETROK_EQUALS] = 46;
	usages[RETROK_LEFTBRACKET] = 47;
	usages[RETROK_RIGHTBRACKET] = 48;
	usages[RETROK_BACKSLASH] = 49;
	usages[RETROK_SEMICOLON] = 51;
	usages[RETROK_QUOTE] = 52;
	usages[RETROK_BACKQUOTE] = 53;
	usages[RETROK_COMMA] = 54;
	usages[RETROK_PERIOD] = 55;
	usages[RETROK_SLASH] = 56;
	usages[RETROK_CAPSLOCK] = 57;
	for (unsigned key = RETROK_F1; key <= RETROK_F12; key += 1u) {
		usages[key] = static_cast<i16>(58u + key - RETROK_F1);
	}
	usages[RETROK_PRINT] = 70;
	usages[RETROK_SCROLLOCK] = 71;
	usages[RETROK_PAUSE] = 72;
	usages[RETROK_INSERT] = 73;
	usages[RETROK_HOME] = 74;
	usages[RETROK_PAGEUP] = 75;
	usages[RETROK_DELETE] = 76;
	usages[RETROK_END] = 77;
	usages[RETROK_PAGEDOWN] = 78;
	usages[RETROK_RIGHT] = HID_USAGE_ARROW_RIGHT;
	usages[RETROK_LEFT] = HID_USAGE_ARROW_LEFT;
	usages[RETROK_DOWN] = HID_USAGE_ARROW_DOWN;
	usages[RETROK_UP] = HID_USAGE_ARROW_UP;
	usages[RETROK_NUMLOCK] = 83;
	usages[RETROK_KP_DIVIDE] = 84;
	usages[RETROK_KP_MULTIPLY] = 85;
	usages[RETROK_KP_MINUS] = 86;
	usages[RETROK_KP_PLUS] = 87;
	usages[RETROK_KP_ENTER] = 88;
	for (unsigned key = RETROK_KP1; key <= RETROK_KP9; key += 1u) {
		usages[key] = static_cast<i16>(89u + key - RETROK_KP1);
	}
	usages[RETROK_KP0] = 98;
	usages[RETROK_KP_PERIOD] = 99;
	usages[RETROK_OEM_102] = 100;
	usages[RETROK_MENU] = 101;
	usages[RETROK_POWER] = 102;
	usages[RETROK_KP_EQUALS] = 103;
	for (unsigned key = RETROK_F13; key <= RETROK_F15; key += 1u) {
		usages[key] = static_cast<i16>(104u + key - RETROK_F13);
	}
	usages[RETROK_LCTRL] = 224;
	usages[RETROK_LSHIFT] = HID_USAGE_SHIFT_LEFT;
	usages[RETROK_LALT] = 226;
	usages[RETROK_LMETA] = 227;
	usages[RETROK_LSUPER] = 227;
	usages[RETROK_RCTRL] = 228;
	usages[RETROK_RSHIFT] = HID_USAGE_SHIFT_RIGHT;
	usages[RETROK_RALT] = 230;
	usages[RETROK_RMETA] = 231;
	usages[RETROK_RSUPER] = 231;
	return usages;
}

constexpr std::array<i16, RETROK_LAST> kRetroKeyHidUsages = makeRetroKeyHidUsages();

static void installBuiltinRenderPipeline(GameView* view, GPUBackend* backend) {
	view->setPipelineRegistry(std::unique_ptr<RenderPassLibrary>());
	auto registry = std::make_unique<RenderPassLibrary>(backend, view);
	view->setPipelineRegistry(std::move(registry));
	view->rebuildGraph();
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
 * LibretroPlatform implementation
 * ============================================================================ */

LibretroPlatform::LibretroPlatform(BackendType backend_type, retro_system_av_info& av_info)
	: m_frame_time_sec(static_cast<double>(HZ_SCALE) / static_cast<double>(PAL_REFRESH_UFPS_SCALED))
	, m_backend_type(backend_type) {
	m_framebuffer.resize(
		gxGpuDisplayModeScreenWidth(GX_GPU_RESET_DISPLAY_MODE_WORD),
		static_cast<unsigned>(gxGpuVerticalVisibleLines(GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, GX_GPU_RESET_DISPLAY_MODE_WORD))
	);

	m_audio_buffer.reserve(kAudioReserveFrames);

	// Create platform components
	m_clock = std::make_unique<LibretroHostClock>();
	m_frame_loop = std::make_unique<LibretroFrameLoop>();
	m_lifecycle = std::make_unique<DefaultLifecycle>();
	m_input_hub = std::make_unique<LibretroInputHub>(this);
	m_audio_service = std::make_unique<LibretroAudioService>(this);
	m_gameview_host = std::make_unique<LibretroGameViewHost>(m_framebuffer, m_backend_type, m_environ_cb, av_info);
	m_microtask_queue = std::make_unique<DefaultMicrotaskQueue>();

	// Initialize controller devices
	m_controller_devices.fill(RETRO_DEVICE_JOYPAD);

	// Create and initialize the machine manager
	m_machine_manager = std::make_unique<MachineManager>();
	m_machine_manager->initialize(this);
	if (m_backend_type == BackendType::Software) {
		auto* view = m_machine_manager->view();
		auto* backend = view->backend();
		installBuiltinRenderPipeline(view, backend);
	}

	log(RETRO_LOG_INFO, "[BMSX] Platform initialized\n");
}

LibretroPlatform::~LibretroPlatform() {
	unloadRom();

	// Shutdown the machine manager before destroying platform components
	m_machine_manager->shutdown();
	m_machine_manager.reset();

	log(RETRO_LOG_INFO, "[BMSX] Platform destroyed\n");
}

HostClock* LibretroPlatform::clock() {
	return m_clock.get();
}

void LibretroPlatform::setInputPollCallback(retro_input_poll_t cb) {
	m_input_poll_cb = cb;
	static_cast<LibretroInputHub*>(m_input_hub.get())->setInputPollCallback(cb);
}

void LibretroPlatform::setInputStateCallback(retro_input_state_t cb) {
	m_input_state_cb = cb;
	static_cast<LibretroInputHub*>(m_input_hub.get())->setInputStateCallback(cb);
}

void LibretroPlatform::setHwRenderCallbacks(retro_hw_get_current_framebuffer_t get_current_framebuffer,
											retro_hw_get_proc_address_t get_proc_address) {
#if BMSX_ENABLE_GLES2
	auto* backend = static_cast<OpenGLES2Backend*>(m_machine_manager->view()->backend());
	backend->setContextCallbacks(get_current_framebuffer, get_proc_address);
#else
	(void)get_current_framebuffer;
	(void)get_proc_address;
	throw BMSX_RUNTIME_ERROR("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::onContextReset() {
#if BMSX_ENABLE_GLES2
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: begin\n");
	auto* view = m_machine_manager->view();
	auto* backend = static_cast<OpenGLES2Backend*>(view->backend());
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: backend reset\n");
	backend->setViewportSize(static_cast<i32>(m_framebuffer.width), static_cast<i32>(m_framebuffer.height));
	backend->onContextReset();
	m_machine_manager->texmanager()->clear();

	log(RETRO_LOG_INFO, "[BMSX] onContextReset: rebuild render graph\n");
	installBuiltinRenderPipeline(view, backend);
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: refresh render surfaces\n");
	m_machine_manager->refreshRenderSurfaces();
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: done\n");
#else
	throw BMSX_RUNTIME_ERROR("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::onContextDestroy() {
#if BMSX_ENABLE_GLES2
	auto* view = m_machine_manager->view();
	auto* backend = static_cast<OpenGLES2Backend*>(view->backend());
	backend->captureGxGpuVramSnapshot(m_machine_manager->runtime().machine.gxGpu);
	view->setPipelineRegistry(std::unique_ptr<RenderPassLibrary>());
	m_machine_manager->texmanager()->clear();
	view->clearTextures();
	backend->onContextDestroy();
#else
	throw BMSX_RUNTIME_ERROR("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::setAVInfo(const retro_system_av_info& info) {
	const auto& geometry = info.geometry;
	const unsigned baseWidth = geometry.base_width;
	const unsigned baseHeight = geometry.base_height;

	m_frame_time_sec = 1.0 / info.timing.fps;
	log(RETRO_LOG_INFO, "[BMSX] AV Info set: %ux%u @ %.2fHz, Sample Rate: %.2fHz\n",
		baseWidth,
		baseHeight,
		info.timing.fps,
		info.timing.sample_rate
	);
	log(RETRO_LOG_INFO, "[BMSX] Frame time set: %.3fms (fps %.2f)\n",
		m_frame_time_sec * 1000.0,
		info.timing.fps
	);

	if (m_framebuffer.width != baseWidth || m_framebuffer.height != baseHeight) {
		m_machine_manager->view()->setRenderTargetSize(static_cast<i32>(baseWidth), static_cast<i32>(baseHeight));
	}

	m_audio_service->setTiming(info.timing.sample_rate);
}

void LibretroPlatform::setCrtEffectOptions(bool applyNoise,
											bool applyColorBleed,
											bool applyScanlines,
											bool applyBlur,
											bool applyGlow,
											bool applyFringing,
											bool applyAperture) {
	auto* view = m_machine_manager->view();
	view->applyNoise = applyNoise;
	view->applyColorBleed = applyColorBleed;
	view->applyScanlines = applyScanlines;
	view->applyBlur = applyBlur;
	view->applyGlow = applyGlow;
	view->applyFringing = applyFringing;
	view->applyAperture = applyAperture;
}

void LibretroPlatform::setDeviceQuantizeMode(DeviceQuantizeMode mode) {
	m_device_quantize_mode = mode;
	m_machine_manager->view()->deviceQuantizeMode = mode;
}

void LibretroPlatform::setResourceUsageGizmo(bool enabled) {
	m_machine_manager->view()->showResourceUsageGizmo = enabled;
}

void LibretroPlatform::requestShutdown() {
	if (!m_environ_cb(RETRO_ENVIRONMENT_SHUTDOWN, nullptr)) {
		return;
	}
}

void LibretroPlatform::setControllerDevice(unsigned port, unsigned device) {
	if (port < m_controller_devices.size()) {
		m_controller_devices[port] = device;
	}
}

bool LibretroPlatform::loadRom(const uint8_t* data, size_t size) {
	std::vector<uint8_t> owned(size);
	std::memcpy(owned.data(), data, size);
	return loadRomOwned(std::move(owned));
}

bool LibretroPlatform::loadRomOwned(std::vector<uint8_t>&& data) {
	unloadRom();
	const size_t size = data.size();
	{
		const std::string line = memSnapshotLine("libretro:before_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}

	if (!m_machine_manager->loadRomOwned(std::move(data))) {
		log(RETRO_LOG_ERROR, "[BMSX] Failed to load ROM\n");
		return false;
	}
	setDeviceQuantizeMode(m_device_quantize_mode);
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	{
		const std::string line = memSnapshotLine("libretro:after_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}

	m_rom_loaded = true;
	log(RETRO_LOG_INFO, "[BMSX] ROM loaded (%zu bytes)\n", size);
	return true;
}

void LibretroPlatform::loadSystemRom(const char* romPath) {
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
			return;
		}
	}

	for (const auto& path : systemRomPaths) {
		if (!path.empty()) {
			log(RETRO_LOG_INFO, "[BMSX] No system ROM found at: %s (continuing without)\n", path.c_str());
		}
	}
}

bool LibretroPlatform::loadRomFromPath(const char* path) {
	// Load system ROM first (if available in same directory)
	loadSystemRom(path);

	unloadRom();
	{
		const std::string line = memSnapshotLine("libretro:before_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}

	if (!m_machine_manager->loadRomFile(path)) {
		log(RETRO_LOG_ERROR, "[BMSX] Failed to load ROM file: %s\n", path);
		return false;
	}
	setDeviceQuantizeMode(m_device_quantize_mode);
#if defined(__GLIBC__)
	malloc_trim(0);
#endif
	{
		const std::string line = memSnapshotLine("libretro:after_loadRom");
		if (!line.empty()) {
			log(RETRO_LOG_INFO, "%s\n", line.c_str());
		}
	}

	m_rom_loaded = true;
	log(RETRO_LOG_INFO, "[BMSX] ROM loaded from file: %s\n", path);
	return true;
}

bool LibretroPlatform::loadEmptyCart() {
	unloadRom();

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
		for (const auto& path : systemRomPaths) {
			log(RETRO_LOG_INFO, "[BMSX] No system ROM found at: %s\n", path.c_str());
		}
		log(RETRO_LOG_WARN, "[BMSX] No system ROM found, running without system program\n");
	}

	// Boot system ROM (runs bootrom.lua)
	if (systemRomLoaded && m_machine_manager && m_machine_manager->bootWithoutCart()) {
		log(RETRO_LOG_INFO, "[BMSX] Booted system ROM program\n");
		m_rom_loaded = true;
		return true;
	}

	// Fallback: just mark as loaded to show test pattern
	m_rom_loaded = true;
	log(RETRO_LOG_INFO, "[BMSX] Empty cart loaded (test pattern mode)\n");
	return true;
}

bool LibretroPlatform::loadSystemRomFromFile(const std::string& path) {
	if (!m_machine_manager->loadSystemRomFile(path)) {
		log(RETRO_LOG_WARN, "[BMSX] Failed to load system ROM: %s\n", path.c_str());
		return false;
	}
#if defined(__GLIBC__)
	malloc_trim(0);
#endif

	log(RETRO_LOG_INFO, "[BMSX] System ROM loaded from: %s\n", path.c_str());
	return true;
}

void LibretroPlatform::unloadRom() {
	if (m_rom_loaded) {
		static_cast<LibretroInputHub*>(m_input_hub.get())->resetState();
		// Unload ROM from host core
		if (m_machine_manager) {
			m_machine_manager->unloadRom();
		}
		m_rom_loaded = false;
		log(RETRO_LOG_INFO, "[BMSX] ROM unloaded\n");
	}
}

void LibretroPlatform::reset() {
	m_machine_manager->stop();
	m_audio_service->resetQueue();
	m_audio_buffer.clear();

	if (m_machine_manager && m_machine_manager->romLoaded()) {
		if (!m_machine_manager->rebootLoadedRom()) {
			log(RETRO_LOG_ERROR, "[BMSX] Reset failed: runtime reset failed\n");
			return;
		}
	} else if (!loadEmptyCart()) {
		log(RETRO_LOG_ERROR, "[BMSX] Reset failed: empty cart boot failed\n");
		return;
	}

	m_machine_manager->start();
	log(RETRO_LOG_INFO, "[BMSX] Game reset (runtime rebooted)\n");
}

bool LibretroPlatform::runFrame() {
	if (!m_rom_loaded) return false;

	// Clear audio buffer
	m_audio_buffer.clear();

	const f64 dt = m_frame_time_sec;

	// Advance clock
	m_clock->advanceFrame(1.0 / dt);
	static_cast<LibretroFrameLoop*>(m_frame_loop.get())->runPushedFrame(m_clock->now(), dt);

	if (!m_platform_paused) {
		m_machine_manager->startLoadedRuntimeFrame(m_rom_loaded);
	}

	// Poll the platform hub before the runtime frame loop consumes and latches
	// input for this host frame.
	pollInput();

	const bool presented = m_machine_manager->runHostFrame(m_machine_manager->runtime(), *m_microtask_queue, dt, m_platform_paused);
	m_audio_service->collectSamples(m_audio_buffer);
	return presented;
}

void LibretroPlatform::setPlatformPaused(bool paused) {
	if (paused == m_platform_paused) {
		return;
	}
	m_platform_paused = paused;
	m_machine_manager->setHostPaused(paused, m_rom_loaded);
}

// disable-next-line single_line_method_pattern -- frame input polling stays on the platform API while the libretro hub owns device polling.
void LibretroPlatform::pollInput() {
	static_cast<LibretroInputHub*>(m_input_hub.get())->poll();
}

void LibretroPlatform::log(LogLevel level, std::string_view message) {
	retro_log_level retroLevel = RETRO_LOG_INFO;
	switch (level) {
		case LogLevel::Debug:
			retroLevel = RETRO_LOG_DEBUG;
			break;
		case LogLevel::Info:
			retroLevel = RETRO_LOG_INFO;
			break;
		case LogLevel::Warn:
			retroLevel = RETRO_LOG_WARN;
			break;
		case LogLevel::Error:
			retroLevel = RETRO_LOG_ERROR;
			break;
	}
	m_log_cb(retroLevel, "%.*s", static_cast<int>(message.size()), message.data());
}

void LibretroPlatform::log(retro_log_level level, const char* fmt, ...) {
	if (m_log_cb) {
		va_list args;
		va_start(args, fmt);
		char buffer[1024];
		vsnprintf(buffer, sizeof(buffer), fmt, args);
		va_end(args);
		m_log_cb(level, "%s", buffer);
	}
}

size_t LibretroPlatform::getStateSize() const {
	if (!m_rom_loaded || !m_machine_manager->hasRuntime()) {
		return 0;
	}
	Runtime& runtime = m_machine_manager->runtime();
	if (!runtime.isInitialized()) {
		return 0;
	}
	return kSaveStateEnvelopeBytes;
}

// start fallible-boundary -- libretro serialization callbacks report failure as false after logging.
bool LibretroPlatform::saveState(void* data, size_t size) {
	if (!m_rom_loaded || !m_machine_manager->hasRuntime()) {
		return false;
	}
	Runtime& runtime = m_machine_manager->runtime();
	if (!runtime.isInitialized()) {
		return false;
	}
	if (size < kSaveStateEnvelopeBytes) {
		return false;
	}
	try {
		m_machine_manager->view()->captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		const std::vector<u8> state = captureRuntimeSaveStateBytes(runtime);
		u8* const envelope = static_cast<u8*>(data);
		writeLE32(envelope, kSaveStateMagic);
		writeLE32(envelope + 4u, static_cast<u32>(state.size()));
		std::memcpy(envelope + kSaveStateHeaderBytes, state.data(), state.size());
		std::memset(envelope + kSaveStateHeaderBytes + state.size(), 0, RUNTIME_SAVE_STATE_WIRE_CAPACITY - state.size());
		return true;
	}
	catch (const std::exception& error) {
		log(RETRO_LOG_ERROR, "[BMSX] Save state failed: %s\n", error.what());
		return false;
	}
}

bool LibretroPlatform::loadState(const void* data, size_t size) {
	if (!m_rom_loaded || !m_machine_manager->hasRuntime()) {
		return false;
	}
	Runtime& runtime = m_machine_manager->runtime();
	if (!runtime.isInitialized()) {
		return false;
	}
	try {
		if (size < kSaveStateEnvelopeBytes) {
			return false;
		}
		const u8* const envelope = static_cast<const u8*>(data);
		if (readLE32(envelope) != kSaveStateMagic) {
			return false;
		}
		const size_t payloadBytes = readLE32(envelope + 4u);
		if (payloadBytes > size - kSaveStateHeaderBytes) {
			return false;
		}
		applyRuntimeSaveStateBytes(runtime, envelope + kSaveStateHeaderBytes, payloadBytes);
		m_audio_service->resetQueue();
		m_audio_buffer.clear();
		return true;
	}
	catch (const std::exception& error) {
		log(RETRO_LOG_ERROR, "[BMSX] Load state failed: %s\n", error.what());
		return false;
	}
}
// end fallible-boundary

void LibretroPlatform::resetCheats() {
	// TODO: Clear all cheats
}

void LibretroPlatform::setCheat(unsigned index, bool enabled, const char* code) {
	// TODO: Parse and apply cheat code
	(void)index;
	(void)enabled;
	(void)code;
}

void* LibretroPlatform::getSaveRAM() {
	if (m_save_ram.empty()) {
		return nullptr;
	}
	return m_save_ram.data();
}

size_t LibretroPlatform::getSaveRAMSize() const {
	return m_save_ram.size();
}

void* LibretroPlatform::getSystemRAM() {
	if (m_system_ram.empty()) {
		return nullptr;
	}
	return m_system_ram.data();
}

size_t LibretroPlatform::getSystemRAMSize() const {
	return m_system_ram.size();
}

/* ============================================================================
 * LibretroInputHub implementation
 * ============================================================================ */

LibretroInputHub::LibretroInputHub(LibretroPlatform* platform)
	: m_platform(platform) {
}

void LibretroInputHub::emitEvent(const InputEvt& evt) {
	for (const auto& entry : m_handlers) {
		entry.handler(evt);
	}
}

namespace {

#if defined(BMSX_LIBRETRO_SNESMINI_LAYOUT)
constexpr GamepadButton kLibretroButtonA = GamepadButton::B;
constexpr GamepadButton kLibretroButtonB = GamepadButton::A;
constexpr GamepadButton kLibretroButtonX = GamepadButton::Y;
constexpr GamepadButton kLibretroButtonY = GamepadButton::X;
#else
constexpr GamepadButton kLibretroButtonA = GamepadButton::A;
constexpr GamepadButton kLibretroButtonB = GamepadButton::B;
constexpr GamepadButton kLibretroButtonX = GamepadButton::X;
constexpr GamepadButton kLibretroButtonY = GamepadButton::Y;
#endif

constexpr std::array<GamepadButton, InputState::BUTTONS_PER_PLAYER> kLibretroButtons = {
	kLibretroButtonB,
	kLibretroButtonY,
	GamepadButton::Select,
	GamepadButton::Start,
	GamepadButton::Up,
	GamepadButton::Down,
	GamepadButton::Left,
	GamepadButton::Right,
	kLibretroButtonA,
	kLibretroButtonX,
	GamepadButton::LeftBumper,
	GamepadButton::RightBumper,
	GamepadButton::LeftTrigger,
	GamepadButton::RightTrigger,
	GamepadButton::LeftStick,
	GamepadButton::RightStick,
};

constexpr std::array<PointerControl, 5> kLibretroPointerButtons = {
	PointerControl::Primary,
	PointerControl::Secondary,
	PointerControl::Aux,
	PointerControl::Back,
	PointerControl::Forward,
};

constexpr unsigned kRetroMouseIdX = 0;
constexpr unsigned kRetroMouseIdY = 1;
constexpr unsigned kRetroMouseIdLeft = 2;
constexpr unsigned kRetroMouseIdRight = 3;
constexpr unsigned kRetroMouseIdWheelUp = 4;
constexpr unsigned kRetroMouseIdWheelDown = 5;
constexpr unsigned kRetroMouseIdMiddle = 6;
constexpr unsigned kRetroMouseIdButton4 = 9;
constexpr unsigned kRetroMouseIdButton5 = 10;

constexpr unsigned kRetroPointerIdX = 0;
constexpr unsigned kRetroPointerIdY = 1;
constexpr unsigned kRetroPointerIdPressed = 2;

// Frontends own the physical remap. This canonical chord cannot coincide with
// BMSX's host quick-menu chord (Start+Select+L+R).
constexpr u16 kSupervisorRequestControllerMask =
	(1u << RETRO_DEVICE_ID_JOYPAD_DOWN) |
	(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);

f32 normalizeAxis(i16 value) {
	// Libretro exposes the complete signed 16-bit range. Preserve both endpoints.
	return static_cast<f32>(value) / (value < 0 ? 32768.0F : 32767.0F);
}

i32 pointerAxisToViewport(i16 value, i32 extent) {
	if (extent <= 1) {
		return 0;
	}
	const i32 clamped = std::clamp(static_cast<i32>(value), -32767, 32767);
	const f32 normalized = (static_cast<f32>(clamped) + 32767.0F) / 65534.0F;
	return static_cast<i32>(std::round(normalized * static_cast<f32>(extent - 1)));
}

} // namespace

void LibretroInputHub::poll() {
	m_input_poll_cb();
	InputState newState;

	for (u8 player = 0u; player < InputState::MAX_PLAYERS; player += 1u) {
		u16 buttons = 0u;
		for (u8 button = 0u; button < InputState::BUTTONS_PER_PLAYER; button += 1u) {
			if (m_input_state_cb(player, RETRO_DEVICE_JOYPAD, 0, button)) {
				buttons |= static_cast<u16>(1u << button);
			}
		}
		newState.buttons[player] = buttons;

		const size_t analogBase = static_cast<size_t>(player) * 4u;
		newState.analog[analogBase] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_LEFT, RETRO_DEVICE_ID_ANALOG_X);
		newState.analog[analogBase + 1u] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_LEFT, RETRO_DEVICE_ID_ANALOG_Y);
		newState.analog[analogBase + 2u] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_RIGHT, RETRO_DEVICE_ID_ANALOG_X);
		newState.analog[analogBase + 3u] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_RIGHT, RETRO_DEVICE_ID_ANALOG_Y);

		const u16 changedButtons = newState.buttons[player] ^ m_prev_state.buttons[player];
		for (u8 button = 0u; button < InputState::BUTTONS_PER_PLAYER; button += 1u) {
			const u16 mask = static_cast<u16>(1u << button);
			if ((changedButtons & mask) == 0u) {
				continue;
			}
			const bool pressed = (newState.buttons[player] & mask) != 0u;
			emitEvent(InputEvt{
				.type = pressed ? InputEvtType::ButtonDown : InputEvtType::ButtonUp,
				.input = InputControl{
					.source = InputSource::Gamepad,
					.deviceSlot = player,
					.control = static_cast<u8>(kLibretroButtons[button]),
				},
				.value = pressed ? 1.0F : 0.0F,
			});
		}

		if (newState.analog[analogBase] != m_prev_state.analog[analogBase] ||
			newState.analog[analogBase + 1u] != m_prev_state.analog[analogBase + 1u]) {
			emitEvent(InputEvt{
				.type = InputEvtType::Axis2,
				.input = InputControl{
					.source = InputSource::Gamepad,
					.deviceSlot = player,
					.control = static_cast<u8>(GamepadStick::Left),
				},
				.x = normalizeAxis(newState.analog[analogBase]),
				.y = normalizeAxis(newState.analog[analogBase + 1u]),
			});
		}
		if (newState.analog[analogBase + 2u] != m_prev_state.analog[analogBase + 2u] ||
			newState.analog[analogBase + 3u] != m_prev_state.analog[analogBase + 3u]) {
			emitEvent(InputEvt{
				.type = InputEvtType::Axis2,
				.input = InputControl{
					.source = InputSource::Gamepad,
					.deviceSlot = player,
					.control = static_cast<u8>(GamepadStick::Right),
				},
				.x = normalizeAxis(newState.analog[analogBase + 2u]),
				.y = normalizeAxis(newState.analog[analogBase + 3u]),
			});
		}
	}

	m_controller_supervisor_request =
		(newState.buttons[0] & kSupervisorRequestControllerMask) == kSupervisorRequestControllerMask;
	updateSupervisorRequestLine();

	const i16 mouseDeltaX = m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdX);
	const i16 mouseDeltaY = m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdY);
	const i16 mouseWheelUp = m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdWheelUp);
	const i16 mouseWheelDown = m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdWheelDown);
	const i16 pointerRawX = m_input_state_cb(0, RETRO_DEVICE_POINTER, 0, kRetroPointerIdX);
	const i16 pointerRawY = m_input_state_cb(0, RETRO_DEVICE_POINTER, 0, kRetroPointerIdY);
	const bool pointerPressed = m_input_state_cb(0, RETRO_DEVICE_POINTER, 0, kRetroPointerIdPressed) != 0;
	const std::array<bool, 5> pointerButtons = {
		m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdLeft) != 0 || pointerPressed,
		m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdRight) != 0,
		m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdMiddle) != 0,
		m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdButton4) != 0,
		m_input_state_cb(0, RETRO_DEVICE_MOUSE, 0, kRetroMouseIdButton5) != 0,
	};
	for (size_t button = 0u; button < pointerButtons.size(); button += 1u) {
		if (pointerButtons[button] == m_prev_pointer_buttons[button]) {
			continue;
		}
		emitEvent(InputEvt{
			.type = pointerButtons[button] ? InputEvtType::ButtonDown : InputEvtType::ButtonUp,
			.input = InputControl{
				.source = InputSource::Pointer,
				.deviceSlot = 0u,
				.control = static_cast<u8>(kLibretroPointerButtons[button]),
			},
			.value = pointerButtons[button] ? 1.0F : 0.0F,
		});
	}

	const bool hasAbsolutePointer = pointerRawX != 0 || pointerRawY != 0 || pointerPressed;
	i32 pointerX = m_prev_pointer_x;
	i32 pointerY = m_prev_pointer_y;
	bool pointerPositionValid = m_prev_pointer_position_valid;
	const i32 viewportWidth = static_cast<i32>(m_platform->getFramebuffer().width);
	const i32 viewportHeight = static_cast<i32>(m_platform->getFramebuffer().height);
	if (hasAbsolutePointer) {
		pointerX = pointerAxisToViewport(pointerRawX, viewportWidth);
		pointerY = pointerAxisToViewport(pointerRawY, viewportHeight);
		pointerPositionValid = true;
	} else if (mouseDeltaX != 0 || mouseDeltaY != 0) {
		if (!pointerPositionValid) {
			pointerX = 0;
			pointerY = 0;
			pointerPositionValid = true;
		}
		pointerX = std::clamp(pointerX + static_cast<i32>(mouseDeltaX), 0, viewportWidth - 1);
		pointerY = std::clamp(pointerY + static_cast<i32>(mouseDeltaY), 0, viewportHeight - 1);
	}
	if (pointerPositionValid &&
		(!m_prev_pointer_position_valid || pointerX != m_prev_pointer_x || pointerY != m_prev_pointer_y)) {
		emitEvent(InputEvt{
			.type = InputEvtType::Axis2,
			.input = InputControl{
				.source = InputSource::Pointer,
				.deviceSlot = 0u,
				.control = static_cast<u8>(PointerControl::Position),
			},
			.x = static_cast<f32>(pointerX),
			.y = static_cast<f32>(pointerY),
		});
	}

	const i32 wheelDelta = static_cast<i32>(mouseWheelDown) - static_cast<i32>(mouseWheelUp);
	if (wheelDelta != 0) {
		emitEvent(InputEvt{
			.type = InputEvtType::Axis1,
			.input = InputControl{
				.source = InputSource::Pointer,
				.deviceSlot = 0u,
				.control = static_cast<u8>(PointerControl::Wheel),
			},
			.value = static_cast<f32>(wheelDelta),
		});
	}

	m_prev_state = newState;
	m_prev_pointer_buttons = pointerButtons;
	m_prev_pointer_x = pointerX;
	m_prev_pointer_y = pointerY;
	m_prev_pointer_position_valid = pointerPositionValid;
}

void LibretroInputHub::postKeyboardEvent(unsigned keycode, bool down) {
	if (keycode >= kRetroKeyHidUsages.size()) {
		return;
	}
	const i16 usage = kRetroKeyHidUsages[keycode];
	if (usage < 0) {
		return;
	}
	bool& pressed = m_pressed_keyboard_usages[static_cast<size_t>(usage)];
	if (pressed == down) {
		return;
	}
	pressed = down;
	emitEvent(InputEvt{
		.type = down ? InputEvtType::ButtonDown : InputEvtType::ButtonUp,
		.input = InputControl{
			.source = InputSource::Keyboard,
			.deviceSlot = 0u,
			.control = static_cast<u8>(usage),
		},
		.value = down ? 1.0F : 0.0F,
	});
	if (usage == HID_USAGE_F2) {
		m_keyboard_supervisor_request = down;
		updateSupervisorRequestLine();
	}
}

void LibretroInputHub::resetState() {
	m_prev_state.clear();
	m_prev_pointer_buttons.fill(false);
	m_prev_pointer_x = 0;
	m_prev_pointer_y = 0;
	m_prev_pointer_position_valid = false;
	m_pressed_keyboard_usages.fill(false);
	m_keyboard_supervisor_request = false;
	m_controller_supervisor_request = false;
	m_supervisor_request_line_high = false;
}

void LibretroInputHub::updateSupervisorRequestLine() {
	const bool lineHigh = m_keyboard_supervisor_request || m_controller_supervisor_request;
	if (lineHigh == m_supervisor_request_line_high) {
		return;
	}
	m_supervisor_request_line_high = lineHigh;
	emitEvent(InputEvt{
		.type = lineHigh ? InputEvtType::SupervisorRequestDown : InputEvtType::SupervisorRequestUp,
		.input = {},
	});
}

SubscriptionHandle LibretroInputHub::subscribe(std::function<void(const InputEvt&)> handler) {
	return addSubscriptionHandler(m_handlers, m_next_handler_id, std::move(handler));
}

/* ============================================================================
 * LibretroAudioService implementation
 * ============================================================================ */

LibretroAudioService::LibretroAudioService(LibretroPlatform* platform)
	: m_platform(platform) {
}

void LibretroAudioService::setTiming(double sampleRate) {
	m_sample_rate = sampleRate;
	m_sample_accumulator = 0.0;
	refreshTargetBufferFrames();
}

void LibretroAudioService::resetQueue() {
	m_sample_accumulator = 0.0;
}

void LibretroAudioService::refreshTargetBufferFrames() {
	const SoundMaster* soundMaster = m_platform->machineManager()->soundMaster();
	const size_t framesPerFrame = static_cast<size_t>(std::ceil(m_sample_rate * soundMaster->mixFrameTimeSec()));
	const size_t requested = static_cast<size_t>(std::ceil(m_sample_rate * soundMaster->mixTargetAheadSec()))
		+ kAudioRequestAheadFrames
		+ kAudioRefillMarginFrames;
	const size_t targetFillFrames = std::clamp(requested, kAudioTargetMinFrames, kAudioTargetMaxFrames);
	m_target_buffer_frames = targetFillFrames > framesPerFrame ? targetFillFrames - framesPerFrame : 0;
}

void LibretroAudioService::collectSamples(AudioBuffer& buffer) {
	SoundMaster* soundMaster = m_platform->machineManager()->soundMaster();
	const double samplesPerFrame = m_sample_rate * soundMaster->mixFrameTimeSec();
	m_sample_accumulator += samplesPerFrame;
	const size_t frames = static_cast<size_t>(m_sample_accumulator);
	if (frames == 0) {
		buffer.clear();
		return;
	}
	m_sample_accumulator -= frames;

	const size_t targetFrames = frames + m_target_buffer_frames;
	int16_t* output = buffer.beginWrite(frames);
	m_platform->machineManager()->runtime().machine.audioOutput.pullOutputFrames(output, frames, static_cast<i32>(m_sample_rate), soundMaster->masterVolume(), targetFrames - frames);
}

/* ============================================================================
 * LibretroHostClock implementation
 * ============================================================================ */

LibretroHostClock::LibretroHostClock() = default;

void LibretroHostClock::advanceFrame(double fps) {
	m_current_time += 1000.0 / fps;
}

/* ============================================================================
 * LibretroFrameLoop implementation
 * ============================================================================ */

void LibretroFrameLoop::runPushedFrame(f64 now, f64 deltaTime) {
	if (!m_running) {
		return;
	}
	m_callback(now, deltaTime);
}

void LibretroFrameLoop::start(std::function<void(double, double)> callback) {
	m_callback = std::move(callback);
	m_running = true;
}

void LibretroFrameLoop::stop() {
	m_callback = {};
	m_running = false;
}

/* ============================================================================
 * LibretroGameViewHost implementation
 * ============================================================================ */

LibretroGameViewHost::LibretroGameViewHost(Framebuffer& framebuffer, BackendType backend_type, retro_environment_t& environ_cb, retro_system_av_info& av_info)
	: m_framebuffer(framebuffer)
	, m_backend_type(backend_type)
	, m_environ_cb(environ_cb)
	, m_av_info(av_info) {
}

std::unique_ptr<GPUBackend> LibretroGameViewHost::createBackend() {
	switch (m_backend_type) {
		case BackendType::OpenGLES2:
#if BMSX_ENABLE_GLES2
			return std::make_unique<OpenGLES2Backend>(
				static_cast<i32>(m_framebuffer.width),
				static_cast<i32>(m_framebuffer.height)
			);
#else
			throw BMSX_RUNTIME_ERROR("[LibretroGameViewHost] OpenGLES2 backend disabled at compile time.");
#endif
		case BackendType::Software:
			return std::make_unique<SoftwareBackend>(
				m_framebuffer.data,
				static_cast<i32>(m_framebuffer.width),
				static_cast<i32>(m_framebuffer.height),
				static_cast<i32>(m_framebuffer.pitch)
			);
		default:
			throw BMSX_RUNTIME_ERROR("[LibretroGameViewHost] Unsupported backend type.");
	}
}

void LibretroGameViewHost::setRenderTargetSize(GPUBackend& backend, i32 width, i32 height) {
	m_av_info.geometry.base_width = static_cast<unsigned>(width);
	m_av_info.geometry.base_height = static_cast<unsigned>(height);
	m_av_info.geometry.aspect_ratio = static_cast<float>(PSX_GPU_DISPLAY_ASPECT_WIDTH) / static_cast<float>(PSX_GPU_DISPLAY_ASPECT_HEIGHT);
	m_environ_cb(RETRO_ENVIRONMENT_SET_GEOMETRY, &m_av_info.geometry);
	m_framebuffer.resize(static_cast<unsigned>(width), static_cast<unsigned>(height));
#if BMSX_ENABLE_GLES2
	if (backend.type() == BackendType::OpenGLES2) {
		auto& glBackend = static_cast<OpenGLES2Backend&>(backend);
		glBackend.setViewportSize(width, height);
		return;
	}
#else
	if (backend.type() == BackendType::OpenGLES2) {
		throw BMSX_RUNTIME_ERROR("[LibretroGameViewHost] OpenGLES2 backend disabled at compile time.");
	}
#endif
	auto& softBackend = static_cast<SoftwareBackend&>(backend);
	softBackend.setFramebuffer(
		m_framebuffer.data,
		width,
		height,
		static_cast<i32>(m_framebuffer.pitch)
	);
}

void* LibretroGameViewHost::getCapability(std::string_view name) {
	// TODO: Return capabilities like viewport-metrics, etc.
	(void)name;
	return nullptr;
}

ViewportDimensions LibretroGameViewHost::getSize(Vec2 viewportSize, Vec2 canvasSize) {
	(void)viewportSize;
	(void)canvasSize;
	ViewportDimensions dims;
	dims.width = static_cast<i32>(m_framebuffer.width);
	dims.height = static_cast<i32>(m_framebuffer.height);
	dims.viewportScale = 1.0f;
	dims.canvasScale = 1.0f;
	return dims;
}

SubscriptionHandle LibretroGameViewHost::onResize(std::function<void(const ViewportDimensions&)> handler) {
	// Libretro doesn't really have dynamic resizing, but we keep the interface
	(void)handler;
	return SubscriptionHandle::create([]() {});
}

SubscriptionHandle LibretroGameViewHost::onFocusChange(std::function<void(bool)> handler) {
	(void)handler;
	return {};
}

} // namespace bmsx
