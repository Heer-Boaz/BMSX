/*
 * platform.cpp - BMSX Platform implementation for libretro
 */

#include "platform.h"
#include "core/console.h"
#include "common/primitives.h"
#include "core/rom_boot_manager.h"
#include "core/system.h"
#include "input/manager.h"
#include "input/gamepad.h"
#include "input/keyboard.h"
#include "input/pointer.h"
#include "render/backend/pass/library.h"
#include "render/texture_manager.h"
#include "render/vdp/context_state.h"
#include "common/mem_snapshot.h"
#include "../../machine/runtime/runtime.h"
#include "../../machine/runtime/save_state/codec.h"
#if BMSX_ENABLE_GLES2
#include "render/backend/gles2_backend.h"
#include "render/post/crt_pipeline_gles2.h"
#endif
#include <chrono>
#include <cstring>
#include <cerrno>
#include <cstdarg>
#include <fstream>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#ifndef ENABLE_PERFORMANCE_LOGS
#define ENABLE_PERFORMANCE_LOGS 0
#endif

namespace bmsx {
namespace {
constexpr double kFrameSpikeMultiplier = 1.2;
constexpr size_t kAudioRefillMarginFrames = 128;
constexpr size_t kAudioRequestAheadFrames = 256;
constexpr size_t kAudioTargetMinFrames = 384;
constexpr size_t kAudioTargetMaxFrames = 4096;
constexpr size_t kAudioReserveVideoFrames = 10;
constexpr size_t kAudioReserveFrames = static_cast<size_t>(DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE * DEFAULT_FRAME_TIME_SEC) * kAudioReserveVideoFrames;
constexpr const char* kReleaseSystemRomName = "bmsx-bios.rom";
constexpr const char* kDebugSystemRomName = "bmsx-bios.debug.rom";
constexpr const char* kDebugRomSuffix = ".debug.rom";
constexpr const char* kKeyboardDeviceId = "keyboard:0";
constexpr const char* kPointerDeviceId = "pointer:0";
constexpr const char* kGamepadDevicePrefix = "gamepad:";

static void installBuiltinRenderPipeline(GameView* view, GPUBackend* backend) {
	auto registry = std::make_unique<RenderPassLibrary>(backend);
	registry->registerBuiltin();
	view->setPipelineRegistry(std::move(registry));
	view->rebuildGraph();
}

class LibretroVoice final : public Voice {
public:
	void play() override { m_playing = true; }
	void stop() override { m_playing = false; }
	void pause() override { m_playing = false; }
	void resume() override { m_playing = true; }
	bool isPlaying() override { return m_playing; }
	void setVolume(f32 vol) override { m_volume = vol; }
	void setPitch(f32 pitch) override { m_pitch = pitch; }
	void setLoop(bool loop) override { m_loop = loop; }
	SubscriptionHandle onEnded(std::function<void()> handler) override {
		return SubscriptionHandle::create(std::move(handler));
	}

private:
	bool m_playing = false;
	bool m_loop = false;
	f32 m_volume = 1.0f;
	f32 m_pitch = 1.0f;
};

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

LibretroPlatform::LibretroPlatform(BackendType backend_type)
	: m_backend_type(backend_type) {
#if !BMSX_ENABLE_GLES2
	if (m_backend_type == BackendType::OpenGLES2) {
		m_backend_type = BackendType::Software;
	}
#endif
	const MachineManifest& systemMachine = defaultSystemMachineManifest();
	m_framebuffer.resize(
		static_cast<unsigned>(systemMachine.viewportWidth),
		static_cast<unsigned>(systemMachine.viewportHeight)
	);

	m_audio_buffer.reserve(kAudioReserveFrames);

	// Create platform components
	m_clock = std::make_unique<LibretroClock>();
	m_frame_loop = std::make_unique<LibretroFrameLoop>();
	m_lifecycle = std::make_unique<DefaultLifecycle>();
	m_input_hub = std::make_unique<LibretroInputHub>(this);
	m_audio_service = std::make_unique<LibretroAudioService>(this);
	m_gameview_host = std::make_unique<LibretroGameViewHost>(m_framebuffer, m_backend_type);
	m_microtask_queue = std::make_unique<DefaultMicrotaskQueue>();

	// Initialize controller devices
	m_controller_devices.fill(RETRO_DEVICE_JOYPAD);

	// Create and initialize the console
	m_console = std::make_unique<ConsoleCore>();
	m_console->initialize(this);
	m_console->view()->crt_postprocessing_enabled = m_crt_postprocessing_enabled;
	if (m_backend_type == BackendType::Software) {
		auto* view = m_console->view();
		auto* backend = view->backend();
		installBuiltinRenderPipeline(view, backend);
	}

	m_keyboard_input = std::make_unique<KeyboardInput>(kKeyboardDeviceId);
	Input::instance().registerDeviceBinding(kKeyboardDeviceId, m_keyboard_input.get(), InputSource::Keyboard, DEFAULT_KEYBOARD_PLAYER_INDEX);
	m_pointer_input = std::make_unique<PointerInput>(kPointerDeviceId);
	Input::instance().registerDeviceBinding(kPointerDeviceId, m_pointer_input.get(), InputSource::Pointer, DEFAULT_KEYBOARD_PLAYER_INDEX);

	for (size_t i = 0; i < InputState::MAX_PLAYERS; i++) {
		std::string deviceId = std::string(kGamepadDevicePrefix) + std::to_string(i);
		auto gamepad = std::make_unique<GamepadInput>(deviceId, "libretro");
		Input::instance().registerDeviceBinding(deviceId, gamepad.get(), InputSource::Gamepad, std::nullopt);
		Input::instance().assignGamepadToPlayer(gamepad.get(), static_cast<i32>(i + 1));
		m_gamepad_inputs[i] = std::move(gamepad);
	}

	log(RETRO_LOG_INFO, "[BMSX] Platform initialized\n");
}

LibretroPlatform::~LibretroPlatform() {
	unloadRom();
	Input::instance().shutdown();

	// Shutdown console before destroying platform components
	if (m_console) {
		m_console->shutdown();
		m_console.reset();
	}

	log(RETRO_LOG_INFO, "[BMSX] Platform destroyed\n");
}

void LibretroPlatform::setInputPollCallback(retro_input_poll_t cb) {
	m_input_poll_cb = cb;
	static_cast<LibretroInputHub*>(m_input_hub.get())->setInputPollCallback(cb);
}

void LibretroPlatform::setInputStateCallback(retro_input_state_t cb) {
	m_input_state_cb = cb;
	static_cast<LibretroInputHub*>(m_input_hub.get())->setInputStateCallback(cb);
}

// disable-next-line single_line_method_pattern -- platform input API keeps the concrete libretro input hub hidden from C ABI callers.
void LibretroPlatform::postKeyboardEvent(std::string_view code, bool down) {
	static_cast<LibretroInputHub*>(m_input_hub.get())->postKeyboardEvent(code, down);
}

// disable-next-line single_line_method_pattern -- keyboard reset is part of the platform input boundary; the hub remains private.
void LibretroPlatform::clearKeyboardState() {
	static_cast<LibretroInputHub*>(m_input_hub.get())->clearKeyboardState();
}

// disable-next-line single_line_method_pattern -- focus reset is exposed as platform state while input hub owns the concrete key state.
void LibretroPlatform::resetFocusState() {
	static_cast<LibretroInputHub*>(m_input_hub.get())->resetFocusState();
}

void LibretroPlatform::notifyFocusChange(bool focused) {
	resetFocusState();
	static_cast<LibretroGameViewHost*>(m_gameview_host.get())->notifyFocusChange(focused);
}

void LibretroPlatform::setHwRenderCallbacks(retro_hw_get_current_framebuffer_t get_current_framebuffer) {
#if BMSX_ENABLE_GLES2
	m_hw_get_current_framebuffer = get_current_framebuffer;
	auto* backend = static_cast<OpenGLES2Backend*>(m_console->view()->backend());
	backend->setFramebufferGetter(m_hw_get_current_framebuffer);
#else
	(void)get_current_framebuffer;
	throw BMSX_RUNTIME_ERROR("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::onContextReset() {
#if BMSX_ENABLE_GLES2
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: begin\n");
	auto* view = m_console->view();
	auto* backend = static_cast<OpenGLES2Backend*>(view->backend());
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: set framebuffer getter\n");
	backend->setFramebufferGetter(m_hw_get_current_framebuffer);
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: backend reset\n");
	backend->onContextReset();
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: set dither\n");
	setDitherType(m_dither_type);
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: update backend host\n");
	static_cast<LibretroGameViewHost*>(m_gameview_host.get())->updateBackend(backend);

	log(RETRO_LOG_INFO, "[BMSX] onContextReset: rebuild render graph\n");
	installBuiltinRenderPipeline(view, backend);
	if (m_render_surfaces_need_refresh) {
		log(RETRO_LOG_INFO, "[BMSX] onContextReset: refresh render surfaces\n");
		m_console->refreshRenderSurfaces();
		m_render_surfaces_need_refresh = false;
	}
	log(RETRO_LOG_INFO, "[BMSX] onContextReset: done\n");
#else
	throw BMSX_RUNTIME_ERROR("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::onContextDestroy() {
#if BMSX_ENABLE_GLES2
	auto* view = m_console->view();
	auto* backend = static_cast<OpenGLES2Backend*>(view->backend());
	if (m_console->hasRuntime()) {
		auto& vdp = m_console->runtime().machine.vdp;
		if (!m_render_surfaces_need_refresh) {
			captureVdpContextState(vdp);
		}
		shutdownVdpContextState();
	}
	m_console->texmanager()->clear();
	m_render_surfaces_need_refresh = true;
	CRTPipeline::shutdownGLES2(backend);
	backend->onContextDestroy();
	view->setPipelineRegistry(std::unique_ptr<RenderPassLibrary>());
#else
	throw BMSX_RUNTIME_ERROR("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::switchToSoftwareBackend() {
	m_backend_type = BackendType::Software;
	auto* view = m_console->view();
	view->crt_postprocessing_enabled = m_crt_postprocessing_enabled;
	auto backend = std::make_unique<SoftwareBackend>(
		m_framebuffer.data,
		static_cast<i32>(m_framebuffer.width),
		static_cast<i32>(m_framebuffer.height),
		static_cast<i32>(m_framebuffer.pitch)
	);
	view->setBackend(std::move(backend));
	auto registry = std::make_unique<RenderPassLibrary>(view->backend());
	registry->registerBuiltin();
	view->setPipelineRegistry(std::move(registry));
	view->rebuildGraph();
	setPostProcessOptions(m_crt_postprocessing_enabled, m_postprocess_scale > 1);
	m_console->refreshRenderSurfaces();
}

void LibretroPlatform::setAVInfo(const retro_system_av_info& info) {
	m_av_info = info;
	m_has_av_info = true;
	const auto& geometry = info.geometry;
	const unsigned baseWidth = geometry.base_width;
	const unsigned baseHeight = geometry.base_height;

	if (baseWidth == 0 || baseHeight == 0) {
		log(RETRO_LOG_WARN, "[BMSX] Ignoring invalid geometry %ux%u\n", baseWidth, baseHeight);
		return;
	}

	m_frame_time_sec = 1.0 / info.timing.fps;
	m_framebuffer.resize(baseWidth, baseHeight);
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

	auto* view = m_console->view();
	Vec2 renderTargetSize{
		static_cast<f32>(baseWidth),
		static_cast<f32>(baseHeight)
	};
	const f32 offscreenScale = static_cast<f32>(m_postprocess_scale);
	Vec2 offscreenSize{
		renderTargetSize.x * offscreenScale,
		renderTargetSize.y * offscreenScale
	};
	view->configureRenderTargets(&renderTargetSize, &renderTargetSize, &offscreenSize);
	auto* backend = view->backend();
	static_cast<LibretroGameViewHost*>(m_gameview_host.get())->updateBackend(backend);

	if (auto* audioService = dynamic_cast<LibretroAudioService*>(m_audio_service.get())) {
		audioService->setTiming(info.timing.sample_rate);
	}
}

void LibretroPlatform::setPostProcessOptions(bool enableCrt, bool highDetail) {
	m_crt_postprocessing_enabled = enableCrt;
	m_postprocess_scale = highDetail ? 2 : 1;

	auto* view = m_console->view();
	view->crt_postprocessing_enabled = enableCrt;
	const Vec2 offscreenSize{
		view->viewportSize.x * static_cast<f32>(m_postprocess_scale),
		view->viewportSize.y * static_cast<f32>(m_postprocess_scale)
	};
	view->configureRenderTargets(nullptr, nullptr, &offscreenSize);
}

void LibretroPlatform::setCrtEffectOptions(bool applyNoise,
											bool applyColorBleed,
											bool applyScanlines,
											bool applyBlur,
											bool applyGlow,
											bool applyFringing,
											bool applyAperture) {
	auto* view = m_console->view();
	view->applyNoise = applyNoise;
	view->applyColorBleed = applyColorBleed;
	view->applyScanlines = applyScanlines;
	view->applyBlur = applyBlur;
	view->applyGlow = applyGlow;
	view->applyFringing = applyFringing;
	view->applyAperture = applyAperture;
}

void LibretroPlatform::setDitherType(i32 type) {
	m_dither_type = type;
	if (!m_console->hasRuntime()) {
		return;
	}
	m_console->runtime().machine.memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(m_dither_type)));
}

void LibretroPlatform::setResourceUsageGizmo(bool enabled) {
	m_console->view()->showResourceUsageGizmo = enabled;
}

void LibretroPlatform::requestShutdown() {
	m_environ_cb(RETRO_ENVIRONMENT_SHUTDOWN, nullptr);
}

void LibretroPlatform::setFrameTimeUsec(retro_usec_t usec) {
	if (usec == 0) {
		return;
	}
	const double nextFrameTimeSec = static_cast<double>(usec) / 1000000.0;
	m_frame_time_sec = nextFrameTimeSec;
}

void LibretroPlatform::setControllerDevice(unsigned port, unsigned device) {
	if (port < m_controller_devices.size()) {
		m_controller_devices[port] = device;
	}
}

void LibretroPlatform::applyManifestViewport() {
	const auto& manifest = m_console->machineManifest();
	m_pending_viewport = {
		static_cast<f32>(manifest.viewportWidth),
		static_cast<f32>(manifest.viewportHeight)
	};
	m_has_pending_viewport = true;
	if (!m_has_av_info) {
		return;
	}

	retro_system_av_info nextInfo = m_av_info;
	auto& geometry = nextInfo.geometry;
	geometry.base_width = static_cast<unsigned>(m_pending_viewport.x);
	geometry.base_height = static_cast<unsigned>(m_pending_viewport.y);
	geometry.max_width = geometry.base_width;
	geometry.max_height = geometry.base_height;
	geometry.aspect_ratio = static_cast<float>(geometry.base_width)
		/ static_cast<float>(geometry.base_height);

	m_has_pending_viewport = false;
	m_environ_cb(RETRO_ENVIRONMENT_SET_GEOMETRY, &geometry);
	setAVInfo(nextInfo);
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

	if (!m_console->loadRomOwned(std::move(data))) {
		log(RETRO_LOG_ERROR, "[BMSX] Failed to load ROM\n");
		return false;
	}
	setDitherType(m_dither_type);
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

void LibretroPlatform::tryLoadSystemRom(const char* romPath) {
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
	tryLoadSystemRom(path);

	// Load the game ROM
	std::ifstream file(path, std::ios::binary | std::ios::ate);
	if (!file) {
		log(RETRO_LOG_ERROR, "[BMSX] Failed to open ROM file: %s\n", path);
		return false;
	}

	size_t size = file.tellg();
	file.seekg(0);

	std::vector<uint8_t> data(size);
	if (!file.read(reinterpret_cast<char*>(data.data()), size)) {
		log(RETRO_LOG_ERROR, "[BMSX] Failed to read ROM file: %s\n", path);
		return false;
	}

	return loadRomOwned(std::move(data));
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
	if (systemRomLoaded && m_console && m_console->bootWithoutCart()) {
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
	std::ifstream file(path, std::ios::binary | std::ios::ate);
	if (!file) {
		log(RETRO_LOG_WARN, "[BMSX] Failed to open system ROM: %s (errno=%d: %s)\n",
			path.c_str(), errno, std::strerror(errno));
		return false;
	}

	size_t size = file.tellg();
	file.seekg(0);

	std::vector<uint8_t> data(size);
	if (!file.read(reinterpret_cast<char*>(data.data()), size)) {
		log(RETRO_LOG_WARN, "[BMSX] Failed to read system ROM: %s (errno=%d: %s)\n",
			path.c_str(), errno, std::strerror(errno));
		return false;
	}

	if (!m_console->loadSystemRomOwned(std::move(data))) {
		log(RETRO_LOG_WARN, "[BMSX] Failed to parse system ROM: %s\n", path.c_str());
		return false;
	}

	log(RETRO_LOG_INFO, "[BMSX] System ROM loaded (%zu bytes) from: %s\n", size, path.c_str());
	return true;
}

void LibretroPlatform::unloadRom() {
	if (m_rom_loaded) {
		// Unload ROM from host core
		if (m_console) {
			m_console->unloadRom();
		}
		m_rom_loaded = false;
		log(RETRO_LOG_INFO, "[BMSX] ROM unloaded\n");
	}
}

void LibretroPlatform::reset() {
	m_console->stop();
	static_cast<LibretroAudioService*>(m_audio_service.get())->resetQueue();
	m_audio_buffer.clear();

	if (m_console && m_console->romLoaded()) {
		if (!m_console->rebootLoadedRom()) {
			log(RETRO_LOG_ERROR, "[BMSX] Reset failed: runtime reset failed\n");
			return;
		}
	} else if (!loadEmptyCart()) {
		log(RETRO_LOG_ERROR, "[BMSX] Reset failed: empty cart boot failed\n");
		return;
	}

	m_console->start();
	log(RETRO_LOG_INFO, "[BMSX] Game reset (runtime rebooted)\n");
}

void LibretroPlatform::runFrame() {
	if (!m_rom_loaded || !m_console) return;

#if ENABLE_PERFORMANCE_LOGS
	const auto frameStart = std::chrono::steady_clock::now();
#endif

	// Clear audio buffer
	m_audio_buffer.clear();

	const f64 dt = m_frame_time_sec;

	// Advance clock
	if (auto* clock = dynamic_cast<LibretroClock*>(m_clock.get())) {
		clock->advanceFrame(1.0 / dt);
	}
	static_cast<LibretroFrameLoop*>(m_frame_loop.get())->runPushedFrame(m_clock->now(), dt);

	if (!m_platform_paused) {
		m_console->startLoadedRuntimeFrame(m_rom_loaded);
	}

	// Poll the platform hub before the runtime frame loop consumes and latches
	// input for this host frame.
	pollInput();

	m_console->runHostFrame(m_console->runtime(), *m_microtask_queue, dt, m_platform_paused);
	processAudio();
}

void LibretroPlatform::setPlatformPaused(bool paused) {
	if (paused == m_platform_paused) {
		return;
	}
	m_platform_paused = paused;
	if (!m_console) {
		return;
	}
	m_console->setHostPaused(paused, m_rom_loaded);
}

// disable-next-line single_line_method_pattern -- frame input polling stays on the platform API while the libretro hub owns device polling.
void LibretroPlatform::pollInput() {
	static_cast<LibretroInputHub*>(m_input_hub.get())->poll();
}

void LibretroPlatform::processAudio() {
	if (auto* audioService = dynamic_cast<LibretroAudioService*>(m_audio_service.get())) {
		audioService->collectSamples(m_audio_buffer);
	}
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
	if (!m_rom_loaded || !m_console->hasRuntime()) {
		return 0;
	}
	Runtime& runtime = m_console->runtime();
	if (!runtime.isInitialized()) {
		return 0;
	}
	return captureRuntimeSaveStateBytes(runtime).size();
}

// start fallible-boundary -- libretro serialization callbacks report failure as false after logging.
bool LibretroPlatform::saveState(void* data, size_t size) {
	if (!m_rom_loaded || !m_console->hasRuntime()) {
		return false;
	}
	Runtime& runtime = m_console->runtime();
	if (!runtime.isInitialized()) {
		return false;
	}
	try {
		const std::vector<u8> state = captureRuntimeSaveStateBytes(runtime);
		if (size < state.size()) {
			return false;
		}
		std::memcpy(data, state.data(), state.size());
		if (size > state.size()) {
			std::memset(static_cast<u8*>(data) + state.size(), 0, size - state.size());
		}
		return true;
	}
	catch (const std::exception& error) {
		log(RETRO_LOG_ERROR, "[BMSX] Save state failed: %s\n", error.what());
		return false;
	}
}

bool LibretroPlatform::loadState(const void* data, size_t size) {
	if (!m_rom_loaded || !m_console->hasRuntime()) {
		return false;
	}
	Runtime& runtime = m_console->runtime();
	if (!runtime.isInitialized()) {
		return false;
	}
	try {
		applyRuntimeSaveStateBytes(runtime, static_cast<const u8*>(data), size);
		static_cast<LibretroAudioService*>(m_audio_service.get())->resetQueue();
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
	for (size_t player = 0; player < InputState::MAX_PLAYERS; player++) {
		m_gamepad_device_ids[player] = std::string(kGamepadDevicePrefix) + std::to_string(player);
	}
}

void LibretroInputHub::emitEvent(const InputEvt& evt) {
	m_event_queue.push_back(evt);
	for (const auto& entry : m_handlers) {
		entry.handler(evt);
	}
}

namespace {

#if defined(BMSX_SNESMINI_LEGACY)
constexpr const char* kLibretroBtnA = "b";
constexpr const char* kLibretroBtnB = "a";
constexpr const char* kLibretroBtnX = "y";
constexpr const char* kLibretroBtnY = "x";
#else
constexpr const char* kLibretroBtnA = "a";
constexpr const char* kLibretroBtnB = "b";
constexpr const char* kLibretroBtnX = "x";
constexpr const char* kLibretroBtnY = "y";
#endif

constexpr std::array<const char*, InputState::BUTTONS_PER_PLAYER> kLibretroButtonIds = {
	kLibretroBtnB,      // RETRO_DEVICE_ID_JOYPAD_B
	kLibretroBtnY,      // RETRO_DEVICE_ID_JOYPAD_Y
	"select", // RETRO_DEVICE_ID_JOYPAD_SELECT
	"start",  // RETRO_DEVICE_ID_JOYPAD_START
	"up",     // RETRO_DEVICE_ID_JOYPAD_UP
	"down",   // RETRO_DEVICE_ID_JOYPAD_DOWN
	"left",   // RETRO_DEVICE_ID_JOYPAD_LEFT
	"right",  // RETRO_DEVICE_ID_JOYPAD_RIGHT
	kLibretroBtnA,      // RETRO_DEVICE_ID_JOYPAD_A
	kLibretroBtnX,      // RETRO_DEVICE_ID_JOYPAD_X
	"lb",     // RETRO_DEVICE_ID_JOYPAD_L
	"rb",     // RETRO_DEVICE_ID_JOYPAD_R
	"lt",     // RETRO_DEVICE_ID_JOYPAD_L2
	"rt",     // RETRO_DEVICE_ID_JOYPAD_R2
	"ls",     // RETRO_DEVICE_ID_JOYPAD_L3
	"rs"      // RETRO_DEVICE_ID_JOYPAD_R3
};

constexpr std::array<const char*, 5> kLibretroPointerButtonIds = {
	"pointer_primary",
	"pointer_secondary",
	"pointer_aux",
	"pointer_back",
	"pointer_forward",
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

f32 normalizeAxis(i16 value) {
	return static_cast<f32>(value) / 32767.0f;
}

i32 pointerAxisToViewport(i16 value, i32 extent) {
	if (extent <= 1) {
		return 0;
	}
	const i32 clamped = std::clamp(static_cast<i32>(value), -32767, 32767);
	const f32 normalized = (static_cast<f32>(clamped) + 32767.0f) / 65534.0f;
	return static_cast<i32>(std::round(normalized * static_cast<f32>(extent - 1)));
}

} // namespace

void LibretroInputHub::poll() {
	m_input_poll_cb();

	InputState new_state;

	// Poll all players
	for (unsigned player = 0; player < InputState::MAX_PLAYERS; player++) {
		const std::string& deviceId = m_gamepad_device_ids[player];
		uint16_t buttons = 0;

		// Poll digital buttons
		for (unsigned btn = 0; btn < InputState::BUTTONS_PER_PLAYER; btn++) {
			if (m_input_state_cb(player, RETRO_DEVICE_JOYPAD, 0, btn)) {
				buttons |= (1 << btn);
			}
		}
		new_state.buttons[player] = buttons;

		// Poll analog sticks
		new_state.analog[player * 4 + 0] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_LEFT, RETRO_DEVICE_ID_ANALOG_X);
		new_state.analog[player * 4 + 1] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_LEFT, RETRO_DEVICE_ID_ANALOG_Y);
		new_state.analog[player * 4 + 2] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_RIGHT, RETRO_DEVICE_ID_ANALOG_X);
		new_state.analog[player * 4 + 3] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_RIGHT, RETRO_DEVICE_ID_ANALOG_Y);

		// Generate events for button changes
		uint16_t changed = new_state.buttons[player] ^ m_prev_state.buttons[player];

		for (unsigned btn = 0; btn < InputState::BUTTONS_PER_PLAYER; btn++) {
			if (changed & (1 << btn)) {
				bool pressed = (new_state.buttons[player] & (1 << btn)) != 0;

				InputEvt evt;
				evt.type = pressed ? InputEvtType::ButtonDown : InputEvtType::ButtonUp;
				evt.deviceId = deviceId;
				evt.code = kLibretroButtonIds[btn];
				evt.value = pressed ? 1.0f : 0.0f;

				emitEvent(evt);
			}
		}

		const size_t analogBase = player * 4;
		bool leftChanged = new_state.analog[analogBase] != m_prev_state.analog[analogBase] ||
			new_state.analog[analogBase + 1] != m_prev_state.analog[analogBase + 1];
		if (leftChanged) {
			InputEvt evt;
			evt.type = InputEvtType::AxisMove;
			evt.deviceId = deviceId;
			evt.code = "ls";
			evt.x = normalizeAxis(new_state.analog[analogBase]);
			evt.y = normalizeAxis(new_state.analog[analogBase + 1]);
			emitEvent(evt);
		}

		bool rightChanged = new_state.analog[analogBase + 2] != m_prev_state.analog[analogBase + 2] ||
			new_state.analog[analogBase + 3] != m_prev_state.analog[analogBase + 3];
		if (rightChanged) {
			InputEvt evt;
			evt.type = InputEvtType::AxisMove;
			evt.deviceId = deviceId;
			evt.code = "rs";
			evt.x = normalizeAxis(new_state.analog[analogBase + 2]);
			evt.y = normalizeAxis(new_state.analog[analogBase + 3]);
			emitEvent(evt);
		}
	}

	const char* pointerDeviceId = kPointerDeviceId;

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

	for (size_t i = 0; i < pointerButtons.size(); ++i) {
		if (pointerButtons[i] == m_prev_pointer_buttons[i]) {
			continue;
		}
		InputEvt evt;
		evt.type = pointerButtons[i] ? InputEvtType::PointerDown : InputEvtType::PointerUp;
		evt.deviceId = pointerDeviceId;
		evt.code = kLibretroPointerButtonIds[i];
		evt.value = pointerButtons[i] ? 1.0f : 0.0f;
		emitEvent(evt);
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
		InputEvt evt;
		evt.type = InputEvtType::PointerMove;
		evt.deviceId = pointerDeviceId;
		evt.code = "pointer_position";
		evt.x = static_cast<f32>(pointerX);
		evt.y = static_cast<f32>(pointerY);
		emitEvent(evt);
	}

	const i32 wheelDelta = static_cast<i32>(mouseWheelDown) - static_cast<i32>(mouseWheelUp);
	if (wheelDelta != 0) {
		InputEvt evt;
		evt.type = InputEvtType::PointerWheel;
		evt.deviceId = pointerDeviceId;
		evt.code = "pointer_wheel";
		evt.value = static_cast<f32>(wheelDelta);
		emitEvent(evt);
	}

	m_prev_state = new_state;
	m_prev_pointer_buttons = pointerButtons;
	m_prev_pointer_x = pointerX;
	m_prev_pointer_y = pointerY;
	m_prev_pointer_position_valid = pointerPositionValid;
}

void LibretroInputHub::postKeyboardEvent(std::string_view code, bool down) {
	std::string key(code);
	const bool isPressed = m_pressed_keyboard_codes.find(key) != m_pressed_keyboard_codes.end();
	if (down == isPressed) {
		return;
	}
	if (down) {
		m_pressed_keyboard_codes.insert(key);
	} else {
		m_pressed_keyboard_codes.erase(key);
	}
	InputEvt evt;
	evt.type = down ? InputEvtType::KeyDown : InputEvtType::KeyUp;
	evt.deviceId = kKeyboardDeviceId;
	evt.code = std::move(key);
	emitEvent(evt);
}

void LibretroInputHub::clearKeyboardState() {
	if (m_pressed_keyboard_codes.empty()) {
		return;
	}
	std::vector<std::string> pressedCodes;
	pressedCodes.reserve(m_pressed_keyboard_codes.size());
	for (const std::string& code : m_pressed_keyboard_codes) {
		pressedCodes.push_back(code);
	}
	m_pressed_keyboard_codes.clear();
	for (const std::string& code : pressedCodes) {
		InputEvt evt;
		evt.type = InputEvtType::KeyUp;
		evt.deviceId = kKeyboardDeviceId;
		evt.code = code;
		emitEvent(evt);
	}
}

void LibretroInputHub::resetFocusState() {
	m_prev_state.clear();
	m_prev_pointer_buttons.fill(false);
	m_prev_pointer_x = 0;
	m_prev_pointer_y = 0;
	m_prev_pointer_position_valid = false;
	m_pressed_keyboard_codes.clear();
	clearEvtQ();
}

SubscriptionHandle LibretroInputHub::subscribe(std::function<void(const InputEvt&)> handler) {
	return addSubscriptionHandler(m_handlers, m_next_handler_id, std::move(handler));
}

std::optional<InputEvt> LibretroInputHub::nextEvt() {
	if (m_event_queue.empty()) {
		return std::nullopt;
	}
	InputEvt evt = m_event_queue.front();
	m_event_queue.erase(m_event_queue.begin());
	return evt;
}

// disable-next-line single_line_method_pattern -- event queue clear is the public input-hub lifecycle hook for focus/menu transitions.
void LibretroInputHub::clearEvtQ() {
	m_event_queue.clear();
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
	m_queue_start_samples = 0;
	m_queue_samples = 0;
	m_sample_queue.clear();
	refreshTargetBufferFrames();
}

void LibretroAudioService::setFrameTimeSec(double) {
	refreshTargetBufferFrames();
}

void LibretroAudioService::resetQueue() {
	m_sample_accumulator = 0.0;
	m_queue_start_samples = 0;
	m_queue_samples = 0;
	m_sample_queue.clear();
}

void LibretroAudioService::refreshTargetBufferFrames() {
	const SoundMaster* soundMaster = m_platform->console()->soundMaster();
	const size_t framesPerFrame = static_cast<size_t>(std::ceil(m_sample_rate * soundMaster->mixFrameTimeSec()));
	const size_t requested = static_cast<size_t>(std::ceil(m_sample_rate * soundMaster->mixTargetAheadSec()))
		+ kAudioRequestAheadFrames
		+ kAudioRefillMarginFrames;
	const size_t targetFillFrames = std::clamp(requested, kAudioTargetMinFrames, kAudioTargetMaxFrames);
	m_target_buffer_frames = targetFillFrames > framesPerFrame ? targetFillFrames - framesPerFrame : 0;
}

void LibretroAudioService::collectSamples(AudioBuffer& buffer) {
	SoundMaster* soundMaster = m_platform->console()->soundMaster();
	const double samplesPerFrame = m_sample_rate * soundMaster->mixFrameTimeSec();
	m_sample_accumulator += samplesPerFrame;
	const size_t frames = static_cast<size_t>(m_sample_accumulator);
	if (frames == 0) {
		buffer.clear();
		return;
	}
	m_sample_accumulator -= frames;

	const size_t queuedFrames = m_queue_samples / 2;
	const size_t targetFrames = frames + m_target_buffer_frames;
	if (queuedFrames < targetFrames) {
		const size_t renderFrames = targetFrames - queuedFrames;
		const size_t renderSamples = renderFrames * 2;
		if (m_mix_buffer.size() < renderSamples) {
			m_mix_buffer.resize(renderSamples);
		}
		soundMaster->renderSamples(m_mix_buffer.data(), renderFrames, static_cast<i32>(m_sample_rate));

		size_t neededSamples = m_queue_start_samples + m_queue_samples + renderSamples;
		if (m_queue_start_samples > 0 && neededSamples > m_sample_queue.size()) {
			std::memmove(m_sample_queue.data(), m_sample_queue.data() + m_queue_start_samples, m_queue_samples * sizeof(int16_t));
			m_queue_start_samples = 0;
			neededSamples = m_queue_samples + renderSamples;
		}
		if (m_sample_queue.size() < neededSamples) {
			m_sample_queue.resize(neededSamples);
		}
		std::memcpy(m_sample_queue.data() + m_queue_start_samples + m_queue_samples, m_mix_buffer.data(), renderSamples * sizeof(int16_t));
		m_queue_samples += renderSamples;
	}

	buffer.write(m_sample_queue.data() + m_queue_start_samples, frames);
	m_queue_start_samples += frames * 2;
	m_queue_samples -= frames * 2;
	if (m_queue_samples == 0) {
		m_queue_start_samples = 0;
	}
}

Voice* LibretroAudioService::createVoice() {
	auto voice = std::make_unique<LibretroVoice>();
	Voice* raw = voice.get();
	m_voices.push_back(std::move(voice));
	return raw;
}

void LibretroAudioService::destroyVoice(Voice* voice) {
	const auto it = std::find_if(m_voices.begin(), m_voices.end(), [voice](const std::unique_ptr<Voice>& owned) {
		return owned.get() == voice;
	});
	if (it == m_voices.end()) {
		throw BMSX_RUNTIME_ERROR("Attempted to destroy an unknown libretro voice.");
	}
	m_voices.erase(it);
}

/* ============================================================================
 * LibretroClock implementation
 * ============================================================================ */

LibretroClock::LibretroClock() = default;

void LibretroClock::advanceFrame(double fps) {
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

LibretroGameViewHost::LibretroGameViewHost(Framebuffer& framebuffer, BackendType backend_type)
	: m_framebuffer(framebuffer)
	, m_backend_type(backend_type) {
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

void LibretroGameViewHost::updateBackend(GPUBackend* backend) {
#if BMSX_ENABLE_GLES2
	if (backend->type() == BackendType::OpenGLES2) {
		auto* glBackend = static_cast<OpenGLES2Backend*>(backend);
		glBackend->setViewportSize(static_cast<i32>(m_framebuffer.width),
									static_cast<i32>(m_framebuffer.height));
		return;
	}
#else
	if (backend->type() == BackendType::OpenGLES2) {
		throw BMSX_RUNTIME_ERROR("[LibretroGameViewHost] OpenGLES2 backend disabled at compile time.");
	}
#endif
	auto* softBackend = static_cast<SoftwareBackend*>(backend);
	softBackend->setFramebuffer(
		m_framebuffer.data,
		static_cast<i32>(m_framebuffer.width),
		static_cast<i32>(m_framebuffer.height),
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
	const uint32_t id = m_next_focus_handler_id++;
	m_focus_handlers.emplace(id, std::move(handler));
	return SubscriptionHandle::create([this, id]() {
		m_focus_handlers.erase(id);
	});
}

void LibretroGameViewHost::notifyFocusChange(bool focused) {
	std::vector<std::function<void(bool)>> handlers;
	handlers.reserve(m_focus_handlers.size());
	for (const auto& [id, handler] : m_focus_handlers) {
		(void)id;
		handlers.push_back(handler);
	}
	for (const auto& handler : handlers) {
		handler(focused);
	}
}

} // namespace bmsx
