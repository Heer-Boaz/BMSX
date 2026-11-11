#include "common/mmap_file.h"
#include "cartridge_media.h"
#include "presentation_state.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "render/backend/backend.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/video_presenter.h"
#include "rompack/image.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <chrono>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>

namespace {
using namespace bmsx;
using Clock = std::chrono::steady_clock;

class RecordedInput final : public InputControllerInputSource {
public:
	InputControllerSnapshot current;
	void sampleInputControllerSnapshot(InputControllerSnapshot& snapshot, InputControllerSampleContext) override { snapshot = current; }
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

class OffscreenOutput final : public VideoOutput {
public:
	OffscreenOutput() : VideoOutput(320, 240) {}
	void setDisplaySize(i32, i32, i32 width, i32 height) override {
		visibleViewportBounds = {0, 0, static_cast<f32>(width), static_cast<f32>(height), 0};
	}
};

// Test evidence only, never a cartridge format or a renderer input. Record the
// actual device emissions, rather than a second interpretation of GP0 packets.
struct CommandEvidence {
	std::vector<u32> words;
	std::vector<i64> cycles;
	static void emitted(void* context, const GxGpuCommandBuffer& buffer, size_t i, i64 cycle) {
		auto& log = *static_cast<CommandEvidence*>(context);
		log.cycles.push_back(cycle);
		log.words.insert(log.words.end(), {
			buffer.commandKind[i], buffer.commandOpcode[i], buffer.commandWordCount[i],
			buffer.commandDrawModeWord[i], buffer.commandVramYAddressExtensionWord[i],
			buffer.commandTextureWindowWord[i], buffer.commandDrawingAreaTopLeftWord[i],
			buffer.commandDrawingAreaBottomRightWord[i], buffer.commandDrawingOffsetWord[i],
			buffer.commandMaskBitModeWord[i], buffer.commandSkippedLineParity[i]});
		const auto first = buffer.words.begin() + buffer.commandWordStart[i];
		log.words.insert(log.words.end(), first, first + buffer.commandWordCount[i]);
	}
};
}

int main(int argc, char** argv) {
	try {
		if (argc != 9 && argc != 10) throw std::runtime_error("Usage: runtime_execution_benchmark BIOS CART INPUT_WORDS commands|software|gles2 WARMUP FRAMES STATE TRACE_PREFIX_OR_DASH [--profile-compilation]");
		const bool profileCompilation = argc == 10;
		if (profileCompilation && std::string_view(argv[9]) != "--profile-compilation") throw std::runtime_error("unknown profiling option");
		const std::string renderer = argv[4];
		if (renderer != "commands" && renderer != "software" && renderer != "gles2") throw std::runtime_error("unknown renderer");
		const int warmup = std::stoi(argv[5]), frames = std::stoi(argv[6]);
		if (warmup < 0 || frames <= warmup) throw std::runtime_error("require 0 <= warmup < frames");
		MmapFile systemFile, cartFile, inputFile;
		if (!systemFile.open(argv[1]) || !cartFile.open(argv[2]) || !inputFile.open(argv[3])) throw std::runtime_error("cannot map input files");
		if (inputFile.size() != static_cast<size_t>(frames) * INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT * sizeof(u32)) throw std::runtime_error("input snapshot count differs from requested host frames");
		const auto system = parseSystemRomImage(systemFile.data(), systemFile.size());
		const auto cart = parseCartridgePackage(cartFile.data(), cartFile.size());
		RecordedInput input;
		Runtime runtime({system.bytes, {cartridgeMediaFromPackage(cart), std::nullopt}, PSX_MACHINE_SPEC}, input);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		runtime.machine.cpu.setNativeCompilationProfiling(profileCompilation);
		NativeCompilationProfile compilationStart;
#endif
		auto& gpu = runtime.machine.gxGpu;
		CommandEvidence evidence;
		const bool trace = std::string_view(argv[8]) != "-";
		if (trace) {
			evidence.words.reserve(16 * 1024 * 1024);
			evidence.cycles.reserve(1024 * 1024);
			gpu.setOperationObserver({CommandEvidence::emitted, &evidence});
		}
		EGLDisplay display = EGL_NO_DISPLAY;
		EGLSurface surface = EGL_NO_SURFACE;
		EGLContext context = EGL_NO_CONTEXT;
		if (renderer == "gles2") {
			display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
			if (!eglInitialize(display, nullptr, nullptr) || !eglBindAPI(EGL_OPENGL_ES_API)) throw std::runtime_error("EGL initialization failed");
			const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
				EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
			EGLConfig config;
			EGLint count;
			if (!eglChooseConfig(display, attributes, &config, 1, &count) || count != 1) throw std::runtime_error("no EGL RGBA8 pbuffer config");
			const EGLint size[]{EGL_WIDTH, 320, EGL_HEIGHT, 240, EGL_NONE};
			surface = eglCreatePbufferSurface(display, config, size);
			const EGLint version[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
			context = eglCreateContext(display, config, EGL_NO_CONTEXT, version);
			if (!eglMakeCurrent(display, surface, surface, context)) throw std::runtime_error("cannot activate EGL context");
			std::cerr << "GL_VENDOR=" << glGetString(GL_VENDOR) << "\nGL_RENDERER=" << glGetString(GL_RENDERER) << "\nGL_VERSION=" << glGetString(GL_VERSION) << '\n';
		}
		OffscreenOutput output;
		std::unique_ptr<VideoPresenter> presenter;
		RenderPresentationState presentation;
		if (renderer != "commands") {
			std::unique_ptr<GPUBackend> backend;
			if (renderer == "gles2") {
				auto gles = std::make_unique<OpenGLES2Backend>(320, 240, false, PSX_MACHINE_SPEC.gxGpuVramBytes);
				gles->setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress);
				gles->onContextReset();
				backend = std::move(gles);
			} else backend = std::make_unique<SoftwareBackend>(320, 240, PSX_MACHINE_SPEC.gxGpuVramBytes);
			backend->resizePresentationTarget(320, 240);
			presenter = std::make_unique<VideoPresenter>(output, std::move(backend), 320, 240);
			presenter->installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter->backend(), presenter.get()));
			presenter->initializeDefaultTextures();
			presenter->crt_postprocessing_enabled = false;
		}
		runtime.boot();
		// Fixed host time, as in a frontend: no wall-clock catch-up, pacing,
		// checkpointing, or host audio. The emulated APU still runs normally.
		const double deltaMs = runtime.timing.frameDurationMs;
		double schedulerMs = 0, renderMs = 0, totalMs = 0, maxFrameMs = 0;
		u64 commands = 0, words = 0, presentations = 0;
		for (int frame = 0; frame < frames; ++frame) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (profileCompilation && frame == warmup) compilationStart = runtime.machine.cpu.readNativeCompilationProfile();
#endif
			loadInputControllerSnapshotWords(input.current,
				{reinterpret_cast<const u32*>(inputFile.data()), inputFile.size() / sizeof(u32)},
				static_cast<size_t>(frame) * INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT);
			presentation.beginHostFrame();
			const auto previousTick = runtime.frameScheduler.lastTickSequence;
			const auto start = Clock::now();
			double frameSchedulerMs = 0, frameRenderMs = 0;
			double remainingDelta = deltaMs;
			for (;;) {
				const auto before = Clock::now();
				runtime.frameScheduler.run(runtime, remainingDelta);
				frameSchedulerMs += std::chrono::duration<double, std::milli>(Clock::now() - before).count();
				remainingDelta = 0;
				if (!gpu.backendServicePending()) break;
				const auto renderStart = Clock::now();
				if (gpu.backendCommandDrainPending()) {
					const auto& buffer = gpu.readDeviceOutput().commandBuffer;
					commands += buffer.executedCommandCount;
					words += buffer.executedCommandCount == 0 ? 0 : buffer.commandWordStart[buffer.executedCommandCount - 1] + buffer.commandWordCount[buffer.executedCommandCount - 1];
					if (presenter) presenter->backend().executeGxGpuCommandDrain(gpu);
					else gpu.retireExecutedCommands();
				} else {
					// The command-only ablation is not a fake GPU: it rejects any
					// workload requiring rendered pixels instead of inventing them.
					if (!presenter) throw std::runtime_error("command-only workload requires VRAM readback");
					presenter->backend().executeGxGpuReadback(gpu);
				}
				frameRenderMs += std::chrono::duration<double, std::milli>(Clock::now() - renderStart).count();
				runtime.frameScheduler.synchronizeBackendService(runtime);
			}
			presentation.syncAfterRuntimeUpdate(runtime, previousTick);
			RenderPresentation selected;
			if (const auto* selectedOutput = presentation.prepare(runtime, false, selected)) {
				const auto renderStart = Clock::now();
				if (presenter) {
					presenter->backend().executeGxGpuPresentation(*selectedOutput);
					presentation.present(*presenter, selected, frame * deltaMs / 1000.0, deltaMs / 1000.0);
					if (renderer == "gles2") glFinish();
				}
				if (selected.commitFrame) {
					const auto& buffer = selectedOutput->commandBuffer;
					commands += buffer.presentCommandCount;
					words += buffer.presentCommandCount == 0 ? 0 : buffer.commandWordStart[buffer.presentCommandCount - 1] + buffer.commandWordCount[buffer.presentCommandCount - 1];
					gpu.retirePresentedCommands();
				}
				++presentations;
				frameRenderMs += std::chrono::duration<double, std::milli>(Clock::now() - renderStart).count();
			}
			runtime.machine.audioController.synchronizeOutput().clear();
			const double elapsed = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
			if (frame >= warmup) {
				schedulerMs += frameSchedulerMs;
				renderMs += frameRenderMs;
				totalMs += elapsed;
				maxFrameMs = std::max(maxFrameMs, elapsed);
			}
			if (runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) != 0) throw std::runtime_error("guest supervisor fault");
		}
		// Do not request a renderer snapshot here. This state comparison covers
		// CPU/heap/RAM/devices and cached VRAM bytes, NOT rendered VRAM contents.
		const auto state = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
		std::ofstream stateFile(argv[7], std::ios::binary);
		stateFile.write(reinterpret_cast<const char*>(state.data()), state.size());
		if (!stateFile) throw std::runtime_error("cannot write state evidence");
		if (trace) {
			std::ofstream traceFile(std::string(argv[8]) + ".commands", std::ios::binary);
			traceFile.write(reinterpret_cast<const char*>(evidence.words.data()), evidence.words.size() * sizeof(u32));
			std::ofstream cyclesFile(std::string(argv[8]) + ".cycles", std::ios::binary);
			cyclesFile.write(reinterpret_cast<const char*>(evidence.cycles.data()), evidence.cycles.size() * sizeof(i64));
			if (!traceFile || !cyclesFile) throw std::runtime_error("cannot write command evidence");
		}
		i32 capturedWidth = 0, capturedHeight = 0;
		if (trace && presenter && presenter->gameFrameSequence()) {
			const auto image = presenter->captureGameFrame();
			capturedWidth = image.width;
			capturedHeight = image.height;
			std::ofstream pixels(std::string(argv[8]) + ".rgba", std::ios::binary);
			pixels.write(reinterpret_cast<const char*>(image.pixels.data()), image.pixels.size());
			if (!pixels) throw std::runtime_error("cannot write rendered image evidence");
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		constexpr auto cpu = "cpp-native";
#else
		constexpr auto cpu = "cpp-interpreter";
#endif
		std::cout << std::setprecision(17) << "{\"cpu\":\"" << cpu << "\",\"renderer\":\"" << renderer
			<< "\",\"trace\":" << (trace ? "true" : "false") << ",\"frames\":" << frames << ",\"warmup\":" << warmup
			<< ",\"schedulerMs\":" << schedulerMs << ",\"renderMs\":" << renderMs << ",\"totalMs\":" << totalMs << ",\"maxFrameMs\":" << maxFrameMs
			<< ",\"ticks\":" << runtime.frameScheduler.lastTickSequence << ",\"guestCycles\":" << runtime.machine.scheduler.nowCycles()
			<< ",\"hostDeltaMs\":" << deltaMs << ",\"commands\":" << commands << ",\"commandWords\":" << words << ",\"presentations\":" << presentations
			<< ",\"capturedWidth\":" << capturedWidth << ",\"capturedHeight\":" << capturedHeight
			<< ",\"profileCompilation\":" << (profileCompilation ? "true" : "false") << ",\"compilation\":";
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (profileCompilation) {
			const auto end = runtime.machine.cpu.readNativeCompilationProfile();
			std::cout << "{\"prepareMs\":" << (end.prepareNanoseconds - compilationStart.prepareNanoseconds) / 1000000.0
				<< ",\"coldPrefixPrepareMs\":" << compilationStart.prepareNanoseconds / 1000000.0
				<< ",\"requests\":" << end.prepareRequests - compilationStart.prepareRequests
				<< ",\"regions\":" << end.regionsPublished - compilationStart.regionsPublished
				<< ",\"sourceInstructions\":" << end.sourceInstructions - compilationStart.sourceInstructions
				<< ",\"emittedCodeBytes\":" << end.emittedCodeBytes - compilationStart.emittedCodeBytes
				<< ",\"capacityFlushes\":" << end.capacityFlushes - compilationStart.capacityFlushes
				<< ",\"codeBytes\":" << end.codeBytes << '}';
		} else
#endif
		std::cout << "null";
		std::cout << "}\n";
		presenter.reset();
		if (display != EGL_NO_DISPLAY) {
			eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
			eglDestroyContext(display, context);
			eglDestroySurface(display, surface);
			eglTerminate(display);
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
