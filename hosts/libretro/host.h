/*
 * host.h - BMSX libretro host implementation for libretro
 *
 * This header defines the LibretroHost class that bridges the BMSX machine runtime
 * with the libretro API, allowing the machine to run in RetroArch and other
 * libretro frontends.
 */

#ifndef BMSX_LIBRETRO_HOST_H
#define BMSX_LIBRETRO_HOST_H

#include "bmsx_libretro.h"
#include "common/mmap_file.h"
#include "host_overlay_menu.h"
#include "input.h"
#include "presentation_state.h"
#include "rompack/image.h"
#include "spec/bmsx/cartridge.h"
#include <array>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace bmsx {

class Runtime;
class LibretroAudioOutput;
class VideoPresenter;
struct MachineModelSpec;

/* ============================================================================
 * LibretroHost - libretro product owner
 * ============================================================================ */

class LibretroHost {
public:
	LibretroHost(
		const MachineModelSpec& machineModel,
		LibretroInput& input,
		LibretroAudioOutput& audioOutput,
		VideoPresenter& videoPresenter,
		retro_environment_t environment,
		void (*logCallback)(enum retro_log_level, const char*, ...),
		std::string_view systemDirectory);
	~LibretroHost();

	void onContextReset();
	void onContextDestroy();
	void onContextLost();
	void setPaused(bool paused);

	void setFrameTime(f64 seconds) { m_frame_time_sec = seconds; }

	// ROM management
	bool loadRom(const uint8_t* data, size_t size);
	bool loadRomFromPath(const char* path);
	bool loadSystemRomOwned(std::vector<uint8_t>&& data);
	bool loadCartridgeSlotsOwned(std::array<std::vector<uint8_t>, CARTRIDGE_SLOT_COUNT>&& data);
	bool loadCartridgeSlotsFromPaths(const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths);
	bool loadEmptyCart();
	void unloadRom();
	bool loadSystemRom(const char* romPath);

	// Emulation control
	void reset();
	bool runFrame();
	i32 activeExecutionDomainId() const;
	i64 refreshUfpsScaled() const;
	Runtime& loadedRuntime() { return *m_runtime; }

	// Save states
	size_t getStateSize() const;
	bool saveState(void* data, size_t size);
	bool loadState(const void* data, size_t size);

	// Cheats
	void resetCheats();
	void setCheat(unsigned index, bool enabled, const char* code);

	// Memory access
	void* getSystemRAM();
	size_t getSystemRAMSize() const;

private:
	bool runHostFrame(Runtime& runtime, f64 deltaTime);
	void activateLoadedRuntime(Runtime& runtime);
	void syncHostTiming(Runtime& runtime);
	void log(retro_log_level level, std::string_view message);
	void log(retro_log_level level, const char* fmt, ...);
	void releaseSystemRomMedia();
	bool loadSystemRomFromFile(const std::string& path);
	void startCartridgeSlots(
		const std::array<std::span<const u8>, CARTRIDGE_SLOT_COUNT>& slots);
	void startRuntime();
	void flushSystemOutput(Runtime& runtime);
	void reportRuntimeError(Runtime& runtime, std::string_view message);

	// Libretro callbacks
	retro_environment_t m_environ_cb = nullptr;
	void (*m_log_cb)(enum retro_log_level, const char*, ...) = nullptr;
	std::string m_system_dir;

	// Output buffers
	const MachineModelSpec& m_machine_model;
	LibretroInput& m_input;
	LibretroAudioOutput& m_audio_output;
	VideoPresenter& m_video_presenter;

	double m_frame_time_sec;

	MmapFile m_system_rom_file;
	std::vector<uint8_t> m_system_rom_owned;
	RomImage m_system_rom_image;
	std::array<MmapFile, CARTRIDGE_SLOT_COUNT> m_cartridge_rom_files;
	std::array<std::vector<uint8_t>, CARTRIDGE_SLOT_COUNT> m_cartridge_rom_owned;
	std::array<RomImage, CARTRIDGE_SLOT_COUNT> m_cartridge_rom_images;
	std::unique_ptr<Runtime> m_runtime;

	HostOverlayMenu m_host_overlay_menu;
	RenderPresentationState m_screen;

	bool m_paused = false;
	f64 m_total_time = 0.0;
	f64 m_host_fps = 0.0;
	i64 m_host_ufps_scaled = 0;
};

} // namespace bmsx

#endif // BMSX_LIBRETRO_HOST_H
