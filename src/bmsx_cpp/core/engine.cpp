/*
 * engine.cpp - Core engine implementation
 */

#include "engine.h"
#include "rom_boot_manager.h"
#include "system.h"
#include "input/manager.h"
#include "render/texture_manager.h"
#include "render/vdp/context_state.h"
#include "render/vdp/texture_transfer.h"
#include "../machine/runtime/runtime.h"
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cstdarg>

namespace bmsx {

EngineCore* EngineCore::s_instance = nullptr;

EngineCore::EngineCore() {
	s_instance = this;
	m_active_assets = &m_engine_assets;
	m_machine_manifest = &m_engine_assets.machine;
	m_rom_boot_manager = std::make_unique<RomBootManager>();
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
	initializeVdpTextureTransfer(*m_texture_manager, *m_view);
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
	m_rom_boot_manager->unloadRom(*this);

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
	switch (m_state) {
		case EngineState::Initialized:
		case EngineState::Stopped:
			m_state = EngineState::Running;
			Runtime::instance().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}

// start normalized-body-acceptable -- pause/resume deliberately mirror state-transition symmetry.
void EngineCore::pause() {
	switch (m_state) {
		case EngineState::Running:
			m_state = EngineState::Paused;
			Runtime::instance().screen.clearPresentation();
			break;
		default:
			break;
	}
}

void EngineCore::resume() {
	switch (m_state) {
		case EngineState::Paused:
			m_state = EngineState::Running;
			Runtime::instance().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}
// end normalized-body-acceptable

void EngineCore::stop() {
	switch (m_state) {
		case EngineState::Running:
		case EngineState::Paused:
			m_state = EngineState::Stopped;
			break;
		default:
			break;
	}
}

bool EngineCore::acceptHostFrame(f64 deltaTime) const {
	switch (m_state) {
		case EngineState::Running:
		case EngineState::Paused:
			return deltaTime > 0.0;
		default:
			return false;
	}
}

void EngineCore::startLoadedRuntimeFrame(bool romLoaded) {
	if (romLoaded && m_state == EngineState::Initialized) {
		start();
	}
}

void EngineCore::setHostPaused(bool paused, bool romLoaded) {
	if (paused) {
		pause();
		if (m_sound_master) {
			m_sound_master->stopAllVoices();
		}
		return;
	}

	if (m_state == EngineState::Paused) {
		resume();
	} else {
		startLoadedRuntimeFrame(romLoaded);
	}
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
	initializeVdpTextureTransfer(*m_texture_manager, *m_view);
	m_view->initializeDefaultTextures();
	restoreVdpContextState(Runtime::instance().machine().vdp());
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
} // namespace bmsx
