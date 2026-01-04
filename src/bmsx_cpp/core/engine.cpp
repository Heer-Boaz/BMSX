/*
 * engine.cpp - Core engine implementation
 */

#include "engine.h"
#include "../input/input.h"
#include "../vm/vm_runtime.h"
#include "../vm/font.h"
#include "rompack.h"
#include <cstdio>
#include <chrono>
#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace bmsx {
namespace {
inline f64 to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<f64, std::milli>(duration).count();
}
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
	i32 width = host->width();
	i32 height = host->height();

	// Create GameView with viewport from platform
	m_view = std::make_unique<GameView>(width, height);

	// Get backend from platform (SoftwareBackend for libretro)
	if (host) {
		auto backend = host->createBackend();
		if (backend) {
			m_view->setBackend(std::move(backend));
		}
	}
	m_view->initializeDefaultTextures();

	m_view->bind();

	Input::instance().initialize();
	m_sound_master = std::make_unique<SoundMaster>();
	registry().registerObject(m_sound_master.get());
	m_audio_event_manager = std::make_unique<AudioEventManager>();
	m_audio_event_manager->setSoundMaster(m_sound_master.get());
	m_audio_event_manager->setAssets(&m_assets);
	registry().registerObject(m_audio_event_manager.get());

	m_state = EngineState::Initialized;
	return true;
}

void EngineCore::shutdown() {
	if (m_state == EngineState::Uninitialized) {
		return;
	}

	stop();
	unloadRom();

	// Dispose view
	if (m_view) {
		m_view->dispose();
		m_view.reset();
	}

	// Clear registry (keeps persistent objects)
	m_audio_event_manager->dispose();
	registry().deregister(m_audio_event_manager.get(), true);
	m_audio_event_manager.reset();
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
	}
}

void EngineCore::stop() {
	if (m_state == EngineState::Running || m_state == EngineState::Paused) {
		m_state = EngineState::Stopped;
	}
}

void EngineCore::tick(f64 deltaTime) {
	if (m_state != EngineState::Running) {
		return;
	}

	const auto tickStart = std::chrono::steady_clock::now();

	m_delta_time = deltaTime;
	m_total_time += deltaTime;
	m_frame_count++;

	// Calculate FPS
	if (deltaTime > 0.0) {
		m_fps = 1.0 / deltaTime;
	}

	const auto inputStart = std::chrono::steady_clock::now();
	Input::instance().pollInput();
	const auto inputEnd = std::chrono::steady_clock::now();
	m_last_tick_timing.inputMs = to_ms(inputEnd - inputStart);

	m_last_tick_timing.vmIdeInputMs = 0.0;
	m_last_tick_timing.vmTerminalInputMs = 0.0;
	m_last_tick_timing.vmUpdateMs = 0.0;
	m_last_tick_timing.vmIdeMs = 0.0;
	m_last_tick_timing.vmTerminalMs = 0.0;
	if (VMRuntime::hasInstance()) {
		VMRuntime& runtime = VMRuntime::instance();
		auto ideInputStart = std::chrono::steady_clock::now();
		runtime.tickIdeInput();
		auto ideInputEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.vmIdeInputMs = to_ms(ideInputEnd - ideInputStart);

		auto terminalInputStart = std::chrono::steady_clock::now();
		runtime.tickTerminalInput();
		auto terminalInputEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.vmTerminalInputMs = to_ms(terminalInputEnd - terminalInputStart);

		auto updateStart = std::chrono::steady_clock::now();
		runtime.tickUpdate();
		auto updateEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.vmUpdateMs = to_ms(updateEnd - updateStart);

		auto ideStart = std::chrono::steady_clock::now();
		runtime.tickIDE();
		auto ideEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.vmIdeMs = to_ms(ideEnd - ideStart);

		auto terminalStart = std::chrono::steady_clock::now();
		runtime.tickTerminalMode();
		auto terminalEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.vmTerminalMs = to_ms(terminalEnd - terminalStart);
	}

	// Process microtasks
	m_last_tick_timing.microtaskMs = 0.0;
	if (m_platform && m_platform->microtaskQueue()) {
		const auto microtaskStart = std::chrono::steady_clock::now();
		m_platform->microtaskQueue()->flush();
		const auto microtaskEnd = std::chrono::steady_clock::now();
		m_last_tick_timing.microtaskMs = to_ms(microtaskEnd - microtaskStart);
	}

	m_presentation_pending = true;
	m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
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

		m_last_render_timing.vmDrawMs = 0.0;
		m_last_render_timing.vmIdeDrawMs = 0.0;
		m_last_render_timing.vmTerminalDrawMs = 0.0;
		if (VMRuntime::hasInstance()) {
			VMRuntime& runtime = VMRuntime::instance();
			auto drawStart = std::chrono::steady_clock::now();
			runtime.tickDraw();
			auto drawEnd = std::chrono::steady_clock::now();
			m_last_render_timing.vmDrawMs = to_ms(drawEnd - drawStart);

			auto ideDrawStart = std::chrono::steady_clock::now();
			runtime.tickIDEDraw();
			auto ideDrawEnd = std::chrono::steady_clock::now();
			m_last_render_timing.vmIdeDrawMs = to_ms(ideDrawEnd - ideDrawStart);

			auto terminalDrawStart = std::chrono::steady_clock::now();
			runtime.tickTerminalModeDraw();
			auto terminalDrawEnd = std::chrono::steady_clock::now();
			m_last_render_timing.vmTerminalDrawMs = to_ms(terminalDrawEnd - terminalDrawStart);
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
	uploadTexturesToBackend();
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

bool EngineCore::loadEngineAssets(const u8* data, size_t size) {
	m_engine_assets.clear();
	m_engine_assets_data.assign(data, data + size);

	// Load engine assets from ROM
	if (!loadAssetsFromRom(data, size, m_engine_assets)) {
		m_engine_assets_data.clear();
		return false;
	}

	m_engine_assets_loaded = true;
	m_default_font = std::make_unique<VMFont>(m_engine_assets);
	m_view->default_font = m_default_font.get();
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

	return loadEngineAssets(data.data(), data.size());
}

bool EngineCore::bootWithoutCart() {
	// Boot engine with only engine assets (no cartridge)
	// This runs the system_program.lua which displays "insert cart"

	if (!m_engine_assets_loaded) {
		std::cerr << "[BMSX] bootWithoutCart: engine assets not loaded" << std::endl;
		return false;
	}

	// Check if engine assets have a VM program
	if (!m_engine_assets.hasVmProgram()) {
		std::cerr << "[BMSX] bootWithoutCart: no VM program in engine assets" << std::endl;
		return false;
	}

	std::cerr << "[BMSX] bootWithoutCart: VM program found, booting..." << std::endl;

	// Copy engine assets as the active assets
	// Note: We can't move vmProgram since engine_assets must stay valid
	// Instead, we reference the engine assets directly when booting VM
	m_assets.img = m_engine_assets.img;
	m_assets.audio = m_engine_assets.audio;
	m_assets.model = m_engine_assets.model;
	m_assets.data = m_engine_assets.data;
	m_assets.audioevents = m_engine_assets.audioevents;
	m_assets.atlasTextures = m_engine_assets.atlasTextures;
	m_assets.manifest = m_engine_assets.manifest;
	m_assets.projectRootPath = m_engine_assets.projectRootPath;
	// Don't copy vmProgram - use engine_assets.vmProgram directly below

	Vec2 viewportSize{
		static_cast<f32>(m_engine_assets.manifest.viewportWidth),
		static_cast<f32>(m_engine_assets.manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize);

	// Upload textures to backend
	uploadTexturesToBackend();
	refreshAudioAssets();

	// Boot the VM with the engine's system program
	if (m_engine_assets.vmProgram && m_engine_assets.vmProgram->program) {
		// Create VMRuntime instance if it doesn't exist
		if (!VMRuntime::hasInstance()) {
			VMRuntimeOptions options;
			options.playerIndex = 1;
			options.viewport.x = m_engine_assets.manifest.viewportWidth;
			options.viewport.y = m_engine_assets.manifest.viewportHeight;
			options.canonicalization = m_engine_assets.manifest.canonicalization;
			VMRuntime::createInstance(options);
		}

		// Boot the VM with the pre-compiled program from engine assets
		VMRuntime& runtime = VMRuntime::instance();
		runtime.setCanonicalization(m_engine_assets.manifest.canonicalization);
		runtime.boot(*m_engine_assets.vmProgram);
	}

	m_rom_loaded = true;  // Engine is running (with system program)
	start();  // Start the engine tick/render loop
	return true;
}

bool EngineCore::loadRom(const u8* data, size_t size) {
	unloadRom();

	m_rom_data.assign(data, data + size);

	// Start with engine assets as base (if loaded)
	if (m_engine_assets_loaded) {
		// Copy engine assets as base layer
		m_assets.img = m_engine_assets.img;
		m_assets.audio = m_engine_assets.audio;
		m_assets.model = m_engine_assets.model;
		m_assets.data = m_engine_assets.data;
		m_assets.audioevents = m_engine_assets.audioevents;
		m_assets.atlasTextures = m_engine_assets.atlasTextures;
		// VM program and manifest come from cartridge, not engine
	}

	// Load cartridge assets from ROM (overwrites engine assets with same ID)
	RuntimeAssets cartAssets;
	if (!loadAssetsFromRom(data, size, cartAssets)) {
		m_rom_data.clear();
		m_assets.clear();
		return false;
	}

	// Merge cartridge assets on top of engine assets
	for (auto& [id, asset] : cartAssets.img) {
		m_assets.img[id] = std::move(asset);
	}
	for (auto& [id, asset] : cartAssets.audio) {
		m_assets.audio[id] = std::move(asset);
	}
	for (auto& [id, asset] : cartAssets.model) {
		m_assets.model[id] = std::move(asset);
	}
	for (auto& [id, asset] : cartAssets.data) {
		m_assets.data[id] = std::move(asset);
	}
	for (auto& [id, asset] : cartAssets.audioevents) {
		m_assets.audioevents[id] = std::move(asset);
	}
	for (auto& [id, asset] : cartAssets.atlasTextures) {
		m_assets.atlasTextures[id] = std::move(asset);
	}

	// VM program and manifest always come from cartridge
	m_assets.vmProgram = std::move(cartAssets.vmProgram);
	m_assets.manifest = std::move(cartAssets.manifest);
	m_assets.projectRootPath = std::move(cartAssets.projectRootPath);

	Vec2 viewportSize{
		static_cast<f32>(m_assets.manifest.viewportWidth),
		static_cast<f32>(m_assets.manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize);

	// Upload textures to backend
	uploadTexturesToBackend();
	refreshAudioAssets();

	// Boot the VM if we have a pre-compiled program
	if (m_assets.hasVmProgram()) {
		bootVMFromProgram();
	}

	m_rom_loaded = true;
	return true;
}

void EngineCore::uploadTexturesToBackend() {
	if (!m_view || !m_view->backend()) return;

	auto* backend = m_view->backend();

	// Upload atlas textures
	for (auto& [atlasId, imgAsset] : m_assets.atlasTextures) {
		if (!imgAsset.pixels.empty() && imgAsset.meta.width > 0 && imgAsset.meta.height > 0) {
			TextureParams params;
			TextureHandle handle = backend->createTexture(
				imgAsset.pixels.data(),
				imgAsset.meta.width,
				imgAsset.meta.height,
				params
			);
			imgAsset.textureHandle = reinterpret_cast<uintptr_t>(handle);
			imgAsset.uploaded = true;
		}
	}

	// Upload individual image textures (for non-atlassed images)
	for (auto& [id, imgAsset] : m_assets.img) {
		if (!imgAsset.meta.atlassed && !imgAsset.pixels.empty() &&
			imgAsset.meta.width > 0 && imgAsset.meta.height > 0) {
			TextureParams params;
			TextureHandle handle = backend->createTexture(
				imgAsset.pixels.data(),
				imgAsset.meta.width,
				imgAsset.meta.height,
				params
			);
			imgAsset.textureHandle = reinterpret_cast<uintptr_t>(handle);
			imgAsset.uploaded = true;
		}
	}

	m_view->initializeDefaultTextures();
	const std::string primaryAtlasName = generateAtlasName(0);
	if (m_assets.hasImg(primaryAtlasName)) {
		m_view->setPrimaryAtlas(0);
	} else if (!m_assets.img.empty()) {
		throw std::runtime_error("[EngineCore] Primary atlas '" + primaryAtlasName + "' missing.");
	}
}

void EngineCore::unloadRom() {
	if (m_rom_loaded) {
		m_rom_data.clear();
		m_assets.clear();
		m_audio_event_manager->dispose();
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

void EngineCore::bootVMFromProgram() {
	// Get the pre-compiled program from assets
	if (!m_assets.vmProgram || !m_assets.vmProgram->program) {
		return;
	}

	// Create VMRuntime instance if it doesn't exist
	if (!VMRuntime::hasInstance()) {
		VMRuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = m_assets.manifest.viewportWidth;
		options.viewport.y = m_assets.manifest.viewportHeight;
		options.canonicalization = m_assets.manifest.canonicalization;
		VMRuntime::createInstance(options);
	}

	// Boot the VM with the pre-compiled program
	VMRuntime& runtime = VMRuntime::instance();
	runtime.setCanonicalization(m_assets.manifest.canonicalization);
	runtime.boot(*m_assets.vmProgram);
}

void EngineCore::refreshAudioAssets() {
	const f32 volume = m_sound_master->masterVolume();
	m_sound_master->init(m_assets, volume);
	m_audio_event_manager->setSoundMaster(m_sound_master.get());
	m_audio_event_manager->setAssets(&m_assets);
	m_audio_event_manager->init(m_assets.audioevents);
}

} // namespace bmsx
