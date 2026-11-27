#include "bmsx_libretro.h"
#include "libretro_state.h"
#include "common/endian.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/model.h"
#include "spec/gx/pcrtc.h"

#include <chrono>
#include <thread>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
constexpr uint16_t menuAccept = 1u << RETRO_DEVICE_ID_JOYPAD_B;
constexpr uint16_t menuCancel = 1u << RETRO_DEVICE_ID_JOYPAD_A;
constexpr uint16_t menuKeyboard = 1u << RETRO_DEVICE_ID_JOYPAD_Y;

BmsxInputLifecycleInterfaceV1 inputLifecycle{};
retro_keyboard_callback keyboardCallback{};
std::string systemDirectory;
std::string outputDirectory;
unsigned errorCount = 0;
unsigned videoFrames = 0;
size_t audioFrames = 0;
bool audible = false;
bool audioSuspended = false;
unsigned suspensions = 0;
unsigned resumptions = 0;
unsigned shutdowns = 0;
BmsxShutdownReasonV1 shutdownReason = BMSX_SHUTDOWN_REASON_UNSPECIFIED;
unsigned shutdownReasons = 0;
bool acceptShutdownReason = true;
const char* gamepadHoldAction = nullptr;
bool variablesUpdated = false;
constexpr uint16_t quickMenu = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT)
	| (1u << RETRO_DEVICE_ID_JOYPAD_START);
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
	else ++resumptions;
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
			if (std::strcmp(variable.key, "bmsx_gamepad_hold_action") == 0 && gamepadHoldAction) {
				variable.value = gamepadHoldAction; return true;
			}
			return false;
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
			*static_cast<bool*>(data) = variablesUpdated; variablesUpdated = false; return true;
		case BMSX_ENVIRONMENT_SET_INPUT_LIFECYCLE_INTERFACE_V1:
			inputLifecycle = *static_cast<BmsxInputLifecycleInterfaceV1*>(data); return true;
		case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK:
			keyboardCallback = *static_cast<retro_keyboard_callback*>(data); return true;
		case BMSX_ENVIRONMENT_GET_AUDIO_TRANSPORT_INTERFACE:
			static_cast<BmsxAudioTransportInterface*>(data)->set_suspended = setAudioSuspended; return true;
		case BMSX_ENVIRONMENT_SET_SHUTDOWN_REASON_V1:
			if (!acceptShutdownReason) return false;
			shutdownReason = *static_cast<BmsxShutdownReasonV1*>(data); ++shutdownReasons; return true;
		case RETRO_ENVIRONMENT_SHUTDOWN:
			++shutdowns; return true;
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

std::vector<bmsx::u8> captureBytes() {
	std::vector<bmsx::u8> envelope(retro_serialize_size());
	require(retro_serialize(envelope.data(), envelope.size()), "external state capture failed");
	return envelope;
}

bmsx::RuntimeSaveState capture() {
	const auto envelope = captureBytes();
	const auto size = bmsx::readLE32(envelope.data() + 4);
	return bmsx::decodeRuntimeSaveState(std::span<const bmsx::u8>(envelope.data() + bmsx::LIBRETRO_STATE_HEADER_BYTES, size),
		bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
}

void openRewind() {
	press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START));
	for (int index = 0; index < 3; ++index) press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
	buttons = menuAccept; frame();
	const auto heldCycles = capture().machineState.schedulerNowCycles;
	for (int index = 0; index < 3; ++index) frame();
	require(capture().machineState.schedulerNowCycles == heldCycles, "held accept must not activate the destination page");
	buttons = 0; frame();
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

void checkQuickMenuPause(const char* imageName) {
	const auto before = capture().machineState.schedulerNowCycles;
	const auto suspendedBefore = suspensions;
	const auto resumedBefore = resumptions;
	buttons = quickMenu; frame();
	require(!audioSuspended && suspensions == suspendedBefore, "chord down is pending, not a menu pause");
	const auto atRelease = capture().machineState.schedulerNowCycles;
	buttons = 0; frame();
	require(capture().machineState.schedulerNowCycles == atRelease,
		"short chord release stops execution before the next machine tick");
	require(audioSuspended && suspensions == suspendedBefore + 1,
		"short release suspends frontend audio exactly once");
	const auto heldAudio = audioFrames;
	const auto heldVideo = videoFrames;
	press(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
	press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
	for (int index = 0; index < 3; ++index) frame();
	require(capture().machineState.schedulerNowCycles == atRelease, "drawing and navigating the menu cannot advance the machine");
	require(videoFrames > heldVideo && audioFrames == heldAudio,
		"the menu must keep presenting while no audio batches are submitted");
	require(suspensions == suspendedBefore + 1, "a held pause must not reset audio transport each frame");
	snapshot(imageName);
	press(quickMenu);
	const auto resumed = capture().machineState.schedulerNowCycles;
	require(resumed > before && resumed - before < bmsx::PSX_MACHINE_SPEC.cpuFreqHz / 10,
		"closing the menu resumes without catching up the time spent paused");
	require(!audioSuspended && resumptions == resumedBefore + 1,
		"closing the menu must resume frontend audio exactly once");
}

void checkPausedExternalRestore() {
	press(quickMenu);
	require(audioSuspended, "external restore starts with the options menu paused");
	auto envelope = captureBytes();
	auto state = capture();
	const auto savedCycles = state.machineState.schedulerNowCycles;
	// Use an explicit background-only scanout, independent of game animation.
	auto& pcrtc = state.machineState.machine.gxGpu.pcrtc;
	pcrtc.registerWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = 0u;
	pcrtc.presentWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = 0u;
	pcrtc.registerWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] = 0x002a579bu;
	pcrtc.presentWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] = 0x002a579bu;
	const auto payload = bmsx::encodeRuntimeSaveState(state);
	bmsx::writeLE32(envelope.data() + 4u, static_cast<bmsx::u32>(payload.size()));
	std::memcpy(envelope.data() + bmsx::LIBRETRO_STATE_HEADER_BYTES, payload.data(), payload.size());
	const size_t sample = static_cast<size_t>(height - 8u) * width + 8u;
	const auto previousPixel = pixels[sample] & 0x00ffffffu;
	constexpr uint32_t expectedPixel = 0x009b572au;
	require(previousPixel != expectedPixel, "loaded scanout differs from the held image");
	require(retro_unserialize(envelope.data(), envelope.size()), "paused frontend state load succeeds");
	require(capture().machineState.schedulerNowCycles == savedCycles,
		"paused external restore installs the saved machine time");
	for (int index = 0; index < 3; ++index) frame();
	require(audioSuspended && capture().machineState.schedulerNowCycles == savedCycles,
		"paused external restore redraws without advancing guest time");
	std::cout << "RUNTIME-LIBRETRO-PAUSED-RESTORE expected=" << expectedPixel
		<< " previous=" << previousPixel << " actual=" << (pixels[sample] & 0x00ffffffu)
		<< " held_cycles=" << savedCycles << '\n';
	require((pixels[sample] & 0x00ffffffu) == expectedPixel,
		"paused external restore must publish the restored game image, not the previous presentation history");
	press(quickMenu);
}

} // namespace

int main(int argc, char** argv) {
	try {
		require(argc == 3 || argc == 4, "Usage: bmsx_libretro_rewind_conformance_runner SYSTEM_DIRECTORY CART_ROM [OUTPUT_DIRECTORY]");
		systemDirectory = argv[1];
		if (argc == 4) outputDirectory = argv[3];
		retro_set_environment(environment);
		retro_set_video_refresh(video);
		retro_set_audio_sample_batch(audio);
		retro_set_input_poll(poll);
		retro_set_input_state(input);
		require(!inputLifecycle.cancel_keyboard && !inputLifecycle.cancel_gamepad, "input cancellation is not published before input exists");
		retro_init();
		require(inputLifecycle.cancel_keyboard && inputLifecycle.cancel_gamepad, "live core publishes input cancellation callbacks");
		retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
		const retro_game_info game{argv[2], nullptr, 0, nullptr};
		require(retro_load_game(&game), "real cartridge admission failed");
		require(keyboardCallback.callback, "content admission publishes the physical keyboard callback");
		checkQuickMenuPause("power-on-paused");
		for (int index = 0; index < 6; ++index) frame();
		require(capture().cpuState.executionCartridgeSlot == bmsx::SYSTEM_EXECUTION_DOMAIN_ID,
			"the firmware pause case must execute in the firmware domain");
		checkQuickMenuPause("firmware-paused");
		for (int index = 0; index < 180; ++index) frame();
		require(audible && audioFrames > 48000, "gameplay must deliver real audio");
		checkQuickMenuPause("game-paused");
		const auto beforeStart = capture().machineState.schedulerNowCycles;
		press(1u << RETRO_DEVICE_ID_JOYPAD_START);
		require(!audioSuspended && capture().machineState.schedulerNowCycles > beforeStart,
			"START alone must remain gameplay input");
		const auto suspensionsBeforeCancel = suspensions;
		buttons = quickMenu; frame();
		inputLifecycle.cancel_gamepad(0);
		buttons = 0; frame();
		require(!audioSuspended && suspensions == suspensionsBeforeCancel, "frontend pad cancellation cannot fabricate a short menu release");
		keyboardCallback.callback(true, RETROK_RCTRL, 0, 0);
		keyboardCallback.callback(true, RETROK_RALT, 0, 0); frame();
		inputLifecycle.cancel_keyboard();
		keyboardCallback.callback(false, RETROK_RCTRL, 0, 0);
		keyboardCallback.callback(false, RETROK_RALT, 0, 0); frame();
		require(!audioSuspended && suspensions == suspensionsBeforeCancel, "frontend focus cancellation precedes synthetic keyboard releases");
		const auto latest = capture().machineState.schedulerNowCycles;
		snapshot("live");
		openRewind();
		// The ABI exposes audio transport, serialization and lifecycle, not a
		// seek-completion observer. Detailed review assertions use the real
		// HostRewind/Runtime owners in host_rewind_conformance_runner instead.
		const auto reviewAudio = audioFrames;
		press(1u << RETRO_DEVICE_ID_JOYPAD_LEFT);
		require(audioSuspended, "seeking suspends frontend audio");
		require(audioFrames == reviewAudio, "seeking delivers no replay audio");
		// The frontend API must also expose watch/pause, not only seek/takeover.
		for (int index = 0; index < 120; ++index) frame();
		const auto beforeReplay = capture().machineState.schedulerNowCycles;
		press(menuKeyboard);
		for (int index = 0; index < 12; ++index) frame();
		require(!audioSuspended && audioFrames > reviewAudio, "recorded playback uses frontend audio");
		require(capture().machineState.schedulerNowCycles > beforeReplay, "recorded playback advances the actual machine");
		press(menuKeyboard);
		const auto previewPaused = capture().machineState.schedulerNowCycles;
		const auto pausedAudio = audioFrames;
		for (int index = 0; index < 12; ++index) frame();
		require(audioSuspended && audioFrames == pausedAudio && capture().machineState.schedulerNowCycles == previewPaused, "preview pauses replay at its current machine position");
		press(menuCancel);
		for (int index = 0; index < 4000 && audioSuspended; ++index) frame();
		require(!audioSuspended, "cancel rejoins live frontend audio transport");
		for (int index = 0; index < 12; ++index) frame();
		require(capture().machineState.schedulerNowCycles >= latest, "cancel rejoins recorded end");
		require(audioFrames > reviewAudio, "live audio resumes after cancel");
		std::vector<bmsx::u8> saved(retro_serialize_size());
		require(retro_serialize(saved.data(), saved.size()), "frontend state capture failed");
		const auto savedCycles = capture().machineState.schedulerNowCycles;
		for (int index = 0; index < 20; ++index) frame();
		require(retro_unserialize(saved.data(), saved.size()), "frontend state load failed");
		require(capture().machineState.schedulerNowCycles == savedCycles, "frontend load restores machine time");
		for (int index = 0; index < 5; ++index) frame();
		checkPausedExternalRestore();
		press(quickMenu);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		press(menuAccept); // Reboot cart from the paused menu.
		for (int index = 0; index < 5; ++index) frame();
		require(!audioSuspended && capture().machineState.schedulerNowCycles < savedCycles,
			"menu reboot starts a running new timeline and releases audio suspension");
		for (int index = 0; index < 8; ++index) frame();
		press(quickMenu);
		const auto beforeReset = capture().machineState.schedulerNowCycles;
		retro_reset();
		const auto afterReset = capture().machineState.schedulerNowCycles;
		require(afterReset == 0 || afterReset == beforeReset,
			"frontend reset either commits at the boundary or leaves the old clock untouched");
		for (int index = 0; index < 5; ++index) frame();
		require(!audioSuspended && capture().machineState.schedulerNowCycles < beforeReset,
			"frontend reset from the paused menu boots a new timeline");
		press(quickMenu);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		press(menuAccept); // Exit from the paused menu.
		require(shutdowns == 1 && shutdownReasons == 1 && shutdownReason == BMSX_SHUTDOWN_REASON_EXIT_GAME,
			"the paused menu requests game exit without a suspend");
		retro_unload_game(); retro_deinit();
		require(!inputLifecycle.cancel_keyboard && !inputLifecycle.cancel_gamepad, "deinit revokes callbacks before their input owner is destroyed");
		retro_init();
		require(retro_load_game(nullptr), "cartridge-free firmware admission failed");
		checkQuickMenuPause("no-cart-paused");
		retro_reset();
		for (int index = 0; index < 5; ++index) frame();
		require(!audioSuspended, "frontend reset must leave audio transport running");
		retro_unload_game(); retro_deinit();
		require(!inputLifecycle.cancel_keyboard && !inputLifecycle.cancel_gamepad, "final teardown cannot retain a dangling input callback");

		// Clover configures the same classifier to request a suspend and frontend shutdown.
		gamepadHoldAction = "exit";
		retro_init();
		retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
		require(retro_load_game(&game), "exit-hold cartridge admission failed");
		press(quickMenu);
		require(audioSuspended, "a short configured chord still opens the menu");
		press(quickMenu);
		require(!audioSuspended, "a short configured chord still closes the menu");
		buttons = quickMenu; frame();
		gamepadHoldAction = "rewind"; variablesUpdated = true; frame();
		buttons = 0; frame();
		require(shutdowns == 1 && !audioSuspended,
			"a live option change cancels the pending chord rather than reinterpreting it");
		gamepadHoldAction = "exit"; variablesUpdated = true; frame();
		buttons = quickMenu; frame();
		std::this_thread::sleep_for(std::chrono::milliseconds(510));
		frame();
		require(shutdowns == 2 && shutdownReasons == 2 && shutdownReason == BMSX_SHUTDOWN_REASON_SUSPEND && !audioSuspended,
			"a configured long chord requests a suspend instead of opening rewind");
		const auto cloverState = captureBytes();
		require(!cloverState.empty(), "the frontend can serialize after the shutdown request");
		buttons = 0; frame();
		require(shutdowns == 2 && !audioSuspended, "releasing the long chord cannot repeat shutdown or open the menu");
		acceptShutdownReason = false;
		press(quickMenu);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		press(menuAccept);
		require(shutdowns == 3 && shutdownReasons == 2,
			"frontends without the private reason still receive normal libretro shutdown");
		buttons = 0; frame();
		retro_unload_game(); retro_deinit();
		std::cout << "RUNTIME-LIBRETRO-MENU-PAUSE:PASS\n";
		std::cout << "RUNTIME-LIBRETRO-REWIND-ABI:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
