#include "bmsx_libretro.h"
#include "common/endian.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
#if defined(BMSX_LIBRETRO_SNESMINI_LAYOUT)
constexpr uint16_t menuAccept = 1u << RETRO_DEVICE_ID_JOYPAD_B;
#else
constexpr uint16_t menuAccept = 1u << RETRO_DEVICE_ID_JOYPAD_A;
#endif
std::string systemDirectory;
std::string outputDirectory;
unsigned errorCount = 0;
unsigned videoFrames = 0;
size_t audioFrames = 0;
bool audible = false;
bool audioSuspended = false;
unsigned suspensions = 0;
uint16_t buttons = 0;
std::vector<uint32_t> pixels;
unsigned width = 0, height = 0;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void RETRO_CALLCONV logMessage(retro_log_level level, const char* format, ...) {
	if (level != RETRO_LOG_ERROR) return;
	++errorCount;
	va_list arguments;
	va_start(arguments, format);
	std::vfprintf(stderr, format, arguments);
	va_end(arguments);
}

void RETRO_CALLCONV setAudioSuspended(bool suspended) {
	audioSuspended = suspended;
	if (suspended) ++suspensions;
}

bool environment(unsigned command, void* data) {
	switch (command) {
		case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
			static_cast<retro_log_callback*>(data)->log = logMessage; return true;
		case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
			*static_cast<const char**>(data) = systemDirectory.c_str(); return true;
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
			return *static_cast<retro_pixel_format*>(data) == RETRO_PIXEL_FORMAT_XRGB8888;
		case RETRO_ENVIRONMENT_GET_VARIABLE: {
			auto& variable = *static_cast<retro_variable*>(data);
			if (std::strcmp(variable.key, "bmsx_render_backend") == 0) { variable.value = "software"; return true; }
			if (std::strcmp(variable.key, "bmsx_crt_postprocessing") == 0) { variable.value = "off"; return true; }
			return false;
		}
		case BMSX_ENVIRONMENT_GET_AUDIO_TRANSPORT_INTERFACE:
			static_cast<BmsxAudioTransportInterface*>(data)->set_suspended = setAudioSuspended; return true;
		default: return false;
	}
}

void video(const void* data, unsigned frameWidth, unsigned frameHeight, size_t pitch) {
	if (!data) return;
	++videoFrames;
	width = frameWidth; height = frameHeight;
	pixels.resize(static_cast<size_t>(width) * height);
	for (unsigned row = 0; row < height; ++row) {
		std::memcpy(pixels.data() + static_cast<size_t>(row) * width,
			static_cast<const bmsx::u8*>(data) + row * pitch, width * 4u);
	}
}

size_t audio(const int16_t* samples, size_t frames) {
	require(!audioSuspended, "review delivered audio to the frontend");
	audioFrames += frames;
	for (size_t index = 0; index < frames * 2; ++index) audible = audible || samples[index] != 0;
	return frames;
}

void poll() {}
int16_t input(unsigned port, unsigned device, unsigned, unsigned id) {
	return port == 0 && device == RETRO_DEVICE_JOYPAD && (buttons & (1u << id)) != 0 ? 1 : 0;
}

void frame() {
	retro_run();
	require(errorCount == 0, "real cart or host frame fault");
}

void press(uint16_t mask) {
	buttons = mask; frame(); buttons = 0; frame();
}

void openRewind() {
	press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START));
	for (int index = 0; index < 3; ++index) press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
	press(menuAccept);
}

bmsx::RuntimeSaveState capture() {
	std::vector<bmsx::u8> envelope(retro_serialize_size());
	require(retro_serialize(envelope.data(), envelope.size()), "external state capture failed");
	const auto size = bmsx::readLE32(envelope.data() + 4);
	return bmsx::decodeRuntimeSaveState(std::span<const bmsx::u8>(envelope.data() + 8, size),
		bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
}

void snapshot(const char* name) {
	if (outputDirectory.empty()) return;
	std::filesystem::create_directories(outputDirectory);
	std::ofstream stream(outputDirectory + "/" + name + ".ppm", std::ios::binary);
	stream << "P6\n" << width << " " << height << "\n255\n";
	for (uint32_t pixel : pixels) {
		const char rgb[] = {static_cast<char>(pixel >> 16u), static_cast<char>(pixel >> 8u), static_cast<char>(pixel)};
		stream.write(rgb, 3);
	}
}
} // namespace

int main(int argc, char** argv) {
	try {
		require(argc == 3 || argc == 4, "Usage: bmsx_host_rewind_conformance_runner SYSTEM_DIRECTORY CART_ROM [OUTPUT_DIRECTORY]");
		systemDirectory = argv[1];
		if (argc == 4) outputDirectory = argv[3];
		retro_set_environment(environment);
		retro_set_video_refresh(video);
		retro_set_audio_sample_batch(audio);
		retro_set_input_poll(poll);
		retro_set_input_state(input);
		retro_init();
		retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
		const retro_game_info game{argv[2], nullptr, 0, nullptr};
		require(retro_load_game(&game), "real cartridge admission failed");
		for (int index = 0; index < 1100; ++index) frame();
		require(audible && audioFrames > 48000, "gameplay must deliver real audio");
		const auto latest = capture().machineState.schedulerNowCycles;
		snapshot("live");
		openRewind();
		press(menuAccept);
		const auto reviewed = capture();
		const auto checkpoint = reviewed.machineState.schedulerNowCycles;
		require(checkpoint < latest, "menu must restore a continuously recorded checkpoint");
		require(reviewed.cpuState.executionCartridgeSlot == 0, "game CPU domain restored");
		const auto reviewAudio = audioFrames;
		for (int index = 0; index < 5; ++index) frame();
		require(capture().machineState.schedulerNowCycles == checkpoint, "review holds machine time");
		require(audioFrames == reviewAudio && audioSuspended, "review must mute and clear abandoned audio");
		snapshot("rewind");
		for (int index = 0; index < 3; ++index) press(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		press(menuAccept);
		for (int index = 0; index < 4000 && audioSuspended; ++index) frame();
		require(!audioSuspended, "return to latest must finish bounded replay");
		for (int index = 0; index < 12; ++index) frame();
		require(capture().machineState.schedulerNowCycles >= latest, "return rejoins recorded end");
		require(audioFrames > reviewAudio, "live audio resumes after return");
		openRewind();
		const auto branchEnd = capture().machineState.schedulerNowCycles;
		press(menuAccept);
		const auto branchCycles = capture().machineState.schedulerNowCycles;
		press(1u << RETRO_DEVICE_ID_JOYPAD_DOWN); press(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		press(menuAccept);
		const auto branched = capture().machineState.schedulerNowCycles;
		require(!audioSuspended && branched < branchEnd, "resume here must branch, not return to future");
		for (int index = 0; index < 20; ++index) frame();
		require(capture().machineState.schedulerNowCycles > branchCycles, "branched gameplay advances");
		snapshot("branched");
		std::vector<bmsx::u8> saved(retro_serialize_size());
		require(retro_serialize(saved.data(), saved.size()), "frontend state capture failed");
		const auto savedCycles = capture().machineState.schedulerNowCycles;
		for (int index = 0; index < 20; ++index) frame();
		require(retro_unserialize(saved.data(), saved.size()), "frontend state load failed");
		require(capture().machineState.schedulerNowCycles == savedCycles, "frontend load restores machine time");
		for (int index = 0; index < 5; ++index) frame();
		openRewind(); press(menuAccept);
		require(capture().machineState.schedulerNowCycles == savedCycles, "external load starts a fresh history at the loaded state");
		for (int index = 0; index < 3; ++index) press(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		press(menuAccept);
		for (int index = 0; index < 4000 && audioSuspended; ++index) frame();
		require(!audioSuspended, "loaded timeline rejoins live output");
		retro_reset();
		for (int index = 0; index < 5; ++index) frame();
		require(capture().machineState.schedulerNowCycles < branchCycles, "reboot starts a new timeline");
		std::cout << "{\"host\":\"libretro-rewind\",\"checkpoint\":" << checkpoint
			<< ",\"latest\":" << latest << ",\"branchCycles\":" << branchCycles
			<< ",\"audioFrames\":" << audioFrames << ",\"suspensions\":" << suspensions
			<< ",\"videoFrames\":" << videoFrames << "}\nRUNTIME-LIBRETRO-REWIND:PASS\n";
		retro_unload_game(); retro_deinit();
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
