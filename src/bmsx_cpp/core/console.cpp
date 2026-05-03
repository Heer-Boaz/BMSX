/*
 * console.cpp - Console core implementation
 */

#include "console.h"
#include "font.h"
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

ConsoleCore* ConsoleCore::s_instance = nullptr;

ConsoleCore::ConsoleCore() {
	s_instance = this;
	m_machine_manifest = &defaultSystemMachineManifest();
	m_rom_boot_manager = std::make_unique<RomBootManager>(*this);
}

ConsoleCore::~ConsoleCore() {
	shutdown();
	if (s_instance == this) {
		s_instance = nullptr;
	}
}

ConsoleCore& ConsoleCore::instance() {
	return *s_instance;
}

ConsoleCore* ConsoleCore::instancePtr() {
	return s_instance;
}

bool ConsoleCore::initialize(Platform* platform) {
	if (m_state != ConsoleState::Uninitialized) {
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

	m_state = ConsoleState::Initialized;
	return true;
}

void ConsoleCore::shutdown() {
	if (m_state == ConsoleState::Uninitialized) {
		return;
	}

	stop();
	m_rom_boot_manager->unloadRom();
	m_runtime.reset();

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
	m_state = ConsoleState::Uninitialized;
}

void ConsoleCore::start() {
	switch (m_state) {
		case ConsoleState::Initialized:
		case ConsoleState::Stopped:
			m_state = ConsoleState::Running;
			runtime().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}

// start normalized-body-acceptable -- pause/resume deliberately mirror state-transition symmetry.
void ConsoleCore::pause() {
	switch (m_state) {
		case ConsoleState::Running:
			m_state = ConsoleState::Paused;
			runtime().screen.clearPresentation();
			break;
		default:
			break;
	}
}

void ConsoleCore::resume() {
	switch (m_state) {
		case ConsoleState::Paused:
			m_state = ConsoleState::Running;
			runtime().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}
// end normalized-body-acceptable

void ConsoleCore::stop() {
	switch (m_state) {
		case ConsoleState::Running:
		case ConsoleState::Paused:
			m_state = ConsoleState::Stopped;
			break;
		default:
			break;
	}
}

bool ConsoleCore::acceptHostFrame(f64 deltaTime) const {
	switch (m_state) {
		case ConsoleState::Running:
		case ConsoleState::Paused:
			return deltaTime > 0.0;
		default:
			return false;
	}
}

void ConsoleCore::startLoadedRuntimeFrame(bool romLoaded) {
	if (romLoaded && m_state == ConsoleState::Initialized) {
		start();
	}
}

void ConsoleCore::setHostPaused(bool paused, bool romLoaded) {
	if (paused) {
		pause();
		if (m_sound_master) {
			m_sound_master->stopAllVoices();
		}
		return;
	}

	if (m_state == ConsoleState::Paused) {
		resume();
	} else {
		startLoadedRuntimeFrame(romLoaded);
	}
}

void ConsoleCore::refreshRenderSurfaces() {
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
	restoreVdpContextState(runtime().machine().vdp());
}

void ConsoleCore::log(LogLevel level, const char* fmt, ...) {
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
		message = "ConsoleCore::log: formatting error";
	} else {
		message.resize(static_cast<size_t>(written) + 1);
		vsnprintf(message.data(), message.size(), fmt, args_copy);
		message.resize(static_cast<size_t>(written));
	}
	va_end(args_copy);
	m_platform->log(level, message);
}

Runtime& ConsoleCore::runtime() {
	return *m_runtime;
}

const Runtime& ConsoleCore::runtime() const {
	return *m_runtime;
}

Runtime& ConsoleCore::ensureRuntime(const RuntimeOptions& options) {
	if (!m_runtime) {
		m_runtime = std::make_unique<Runtime>(
			options,
			*clock(),
			*soundMaster(),
			*platform()->microtaskQueue(),
			*view(),
			romBootManager()
		);
		m_view->bindRuntime(*m_runtime);
	}
	return *m_runtime;
}

} // namespace bmsx
