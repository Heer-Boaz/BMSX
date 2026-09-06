#include "audio_output.h"
#include "content.h"
#include "host_frame.h"
#include "host_overlay_menu.h"
#include "input.h"
#include "presentation_state.h"
#include "rewind.h"
#include "video_output.h"
#include "render/backend/pass/library.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"

#include <cstdarg>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
#if defined(BMSX_LIBRETRO_SNESMINI_LAYOUT)
constexpr u16 menuAccept = 1u << RETRO_DEVICE_ID_JOYPAD_B;
constexpr u16 menuCancel = 1u << RETRO_DEVICE_ID_JOYPAD_A;
constexpr u16 menuKeyboard = 1u << RETRO_DEVICE_ID_JOYPAD_Y;
#else
constexpr u16 menuAccept = 1u << RETRO_DEVICE_ID_JOYPAD_A;
constexpr u16 menuCancel = 1u << RETRO_DEVICE_ID_JOYPAD_B;
constexpr u16 menuKeyboard = 1u << RETRO_DEVICE_ID_JOYPAD_X;
#endif
class CountingSoftwareBackend : public SoftwareBackend {
public:
	using SoftwareBackend::SoftwareBackend;
	u32 vramCaptures = 0;
	void captureGxGpuVramSnapshot(GxGpu& gpu) override {
		++vramCaptures;
		SoftwareBackend::captureGxGpuVramSnapshot(gpu);
	}
};
u16 buttons = 0;
u32 errors = 0;
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
void RETRO_CALLCONV logMessage(retro_log_level level, const char* format, ...) {
	if (level != RETRO_LOG_ERROR) return;
	++errors;
	va_list arguments;
	va_start(arguments, format);
	std::vfprintf(stderr, format, arguments);
	va_end(arguments);
}
void poll() {}
int16_t inputState(unsigned port, unsigned device, unsigned, unsigned id) {
	return port == 0 && device == RETRO_DEVICE_JOYPAD && (buttons & (1u << id)) != 0 ? 1 : 0;
}
bool RETRO_CALLCONV supervisorRequest() { return false; }
} // namespace

int main(int argc, char** argv) {
	try {
		require(argc == 3 || argc == 4, "Usage: bmsx_host_rewind_conformance_runner SYSTEM_DIRECTORY CART_ROM [OUTPUT_DIRECTORY]");
		LibretroInput input(supervisorRequest);
		input.setInputPollCallback(poll);
		input.setInputStateCallback(inputState);
		input.setControllerDevice(0, RETRO_DEVICE_JOYPAD);
		auto content = loadLibretroContent(argv[1], {argv[2], ""}, input, {logMessage});
		require(content != nullptr, "real cartridge admission failed");
		auto& runtime = content->runtime;
		auto& history = runtime.history;
		u32 restoredStates = 0;
		i64 restoredCycles = 0;
		runtime.onStateRestored = [&]() {
			++restoredStates;
			restoredCycles = runtime.machine.scheduler.currentNowCycles();
		};
		retro_system_av_info avInfo{};
		LibretroVideoOutput video(avInfo);
		auto backend = std::make_unique<CountingSoftwareBackend>(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
		auto& software = *backend;
		VideoPresenter presenter(video, std::move(backend), 256, 212);
		Font font;
		presenter.default_font = &font;
		presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
		presenter.initializeDefaultTextures();
		presenter.crt_postprocessing_enabled = false;
		RenderPresentationState presentation;
		presentation.reset(presenter, runtime);
		HostRewind rewind(runtime, presenter, presentation);
		HostOverlayMenu menu(input);
		LibretroAudioOutput audio;
		f64 totalTime = 0;
		size_t audioFrames = 0;
		bool audible = false;
		const auto frame = [&]() {
			const f64 delta = runtime.timing.frameDurationMs / 1000.0;
			input.setFrameDurationMs(runtime.timing.frameDurationMs);
			input.poll(static_cast<i32>(presenter.viewportSize.x), static_cast<i32>(presenter.viewportSize.y), (totalTime + delta) * 1000.0);
			runLibretroFrame(runtime, input, menu, rewind, presentation, presenter, totalTime, delta);
			audio.setEmulationFrameTimeSec(delta);
			audio.setMuted(runtime.machine.audioController, rewind.active || (runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) != 0u);
			audio.collectFrame(runtime.machine.audioController);
			audioFrames += audio.frameCount();
			for (size_t index = 0; index < audio.frameCount() * 2; ++index) audible |= audio.data()[index] != 0;
			require(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) == 0u && errors == 0, "real cart fault");
		};
		const auto press = [&](u16 mask) { buttons = mask; frame(); buttons = 0; frame(); };
		const auto settle = [&]() {
			for (unsigned count = 0; count < 4000 && rewind.seeking(); ++count) frame();
			require(!rewind.seeking() && history.mode == HistoryMode::Reviewing, "controller must complete the seek, not merely hold cycles");
			return runtime.machine.scheduler.currentNowCycles();
		};
		const auto returnLive = [&]() {
			for (unsigned count = 0; count < 4000 && rewind.active; ++count) frame();
			require(!rewind.active && history.mode == HistoryMode::Recording, "controller must rejoin live recording");
		};
		const auto openRewind = [&]() {
			press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START));
			for (int index = 0; index < 3; ++index) press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
			buttons = menuAccept; frame();
			const auto held = runtime.machine.scheduler.currentNowCycles();
			for (int index = 0; index < 3; ++index) frame();
			require(runtime.machine.scheduler.currentNowCycles() == held && menu.active(), "held accept must not activate the destination page");
			buttons = 0; frame();
		};
		const auto snapshot = [&](const char* name) {
			if (argc != 4) return;
			std::filesystem::create_directories(argv[3]);
			std::ofstream stream(std::string(argv[3]) + "/" + name + ".ppm", std::ios::binary);
			stream << "P6\n" << software.width() << " " << software.height() << "\n255\n";
			for (i32 index = 0; index < software.width() * software.height(); ++index) {
				const u32 pixel = software.framebuffer()[index];
				const char rgb[] = {static_cast<char>(pixel >> 16u), static_cast<char>(pixel >> 8u), static_cast<char>(pixel)};
				stream.write(rgb, 3);
			}
		};
		for (int index = 0; index < 1100; ++index) frame();
		require(history.checkpointCount() == 2 && history.earliestCycles() > runtime.timing.cpuHz * 6, "continuous two-slot collection must wrap");
		require(audible && audioFrames > 48000, "ordinary gameplay delivers real audio");
		snapshot("live");
		openRewind();
		const i64 latest = history.latestCycles();
		const i64 oldest = history.earliestCycles();
		const u32 capturesBeforeSeek = software.vramCaptures;
		for (int roundTrip = 0; roundTrip < 3; ++roundTrip) {
			press(1u << RETRO_DEVICE_ID_JOYPAD_L);
			const i64 selected = settle();
			require(software.vramCaptures == capturesBeforeSeek, "restore does not copy discarded VRAM");
			require(rewind.positionCycles() == latest - runtime.timing.cpuHz, "LB retains the selected coordinate");
			require(selected <= rewind.positionCycles() && selected > rewind.positionCycles() - runtime.timing.cycleBudgetPerFrame, "machine resolves to the preceding PCRTC boundary");
			const size_t reviewAudio = audioFrames;
			for (int index = 0; index < 5; ++index) frame();
			require(audioFrames == reviewAudio && runtime.machine.scheduler.currentNowCycles() == selected, "review holds machine time and mutes audio");
			snapshot("rewind");
			press(1u << RETRO_DEVICE_ID_JOYPAD_R);
			require(settle() == latest && rewind.positionCycles() == latest, "LB/RB round trip has no rounding drift");
		}
		buttons = 1u << RETRO_DEVICE_ID_JOYPAD_L;
		for (int index = 0; index < 80; ++index) frame();
		buttons = 0; frame();
		require(settle() == oldest, "holding LB reaches the oldest boundary");
		press(1u << RETRO_DEVICE_ID_JOYPAD_L);
		require(settle() == oldest, "oldest boundary never wraps");
		snapshot("oldest");
		require(restoredStates != 0 && restoredCycles == oldest, "post-restore notification observes installed machine state");
		menu.dismiss(input, rewind);
		for (int index = 0; index < 5; ++index) frame();
		require(!menu.active() && rewind.active && runtime.machine.scheduler.currentNowCycles() == oldest
			&& history.latestCycles() == latest, "external view navigation retains selected state and recorded future");
		openRewind();
		press(menuCancel); returnLive();
		for (int index = 0; index < 12; ++index) frame();
		require(runtime.machine.scheduler.currentNowCycles() >= latest, "cancel preserves the recorded future");
		openRewind();
		const i64 branchEnd = history.latestCycles();
		press(1u << RETRO_DEVICE_ID_JOYPAD_L);
		const i64 branch = settle();
		press(1u << RETRO_DEVICE_ID_JOYPAD_START); returnLive();
		for (int index = 0; index < 20; ++index) frame();
		require(runtime.machine.scheduler.currentNowCycles() > branch && history.latestCycles() < branchEnd, "START branches at the selected position");
		snapshot("branched");
		openRewind();
		const i64 beforeKeyboard = history.latestCycles();
		press(1u << RETRO_DEVICE_ID_JOYPAD_L); settle();
		press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | menuKeyboard); returnLive();
		require(runtime.machine.scheduler.currentNowCycles() >= beforeKeyboard, "rewind -> keyboard preserves the recorded future");
		std::cout << "RUNTIME-HOST-REWIND:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
