#include "machine/runtime/frame_loop.h"
#include "core/engine.h"
#include "input/manager.h"
#include "machine/runtime/cart_boot.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "render/shared/queues.h"
#include <algorithm>

namespace bmsx {
namespace {
constexpr double MAX_FRAME_DELTA_MS = 250.0;

inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}
}

void FrameLoopState::reset() {
	frameDeltaMs = 0.0;
}

void FrameLoopState::resetFrameState(Runtime& runtime) {
	frameActive = false;
	runtime.vblank.abandonTick();
	runtime.machine().inputController().restoreSampleArmed(false);
	frameState = FrameState{};
	runtime.vblank.clearHaltUntilIrq(runtime);
	runtime.frameScheduler.reset();
	reset();
	runtime.screen.reset();
	runtime.frameScheduler.resetTickTelemetry();
	runtime.vblank.reset(runtime);
}

void FrameLoopState::beginFrameState(Runtime& runtime) {
	frameActive = true;
	runtime.vblank.beginTick();
	frameState = FrameState{};
	frameState.cycleBudgetRemaining = runtime.timing.cycleBudgetPerFrame;
	frameState.cycleBudgetGranted = runtime.timing.cycleBudgetPerFrame;
	frameState.cycleCarryGranted = 0;
	frameDeltaMs = runtime.timing.frameDurationMs;
	runtime.machine().vdp().beginFrame();
	auto key = [&runtime](std::string_view text) {
		return valueString(runtime.machine().cpu().internString(text));
	};
	auto* const gameTable = asTable(runtime.machine().cpu().getGlobalByKey(key("game")));
	auto* const viewportTable = asTable(gameTable->get(key("viewportsize")));
	const auto viewSize = EngineCore::instance().view()->viewportSize;
	viewportTable->set(key("x"), valueNumber(static_cast<double>(viewSize.x)));
	viewportTable->set(key("y"), valueNumber(static_cast<double>(viewSize.y)));
	auto* const viewTable = asTable(gameTable->get(key("view")));
	auto* const view = EngineCore::instance().view();
	viewTable->set(key("crt_postprocessing_enabled"), valueBool(view->crt_postprocessing_enabled));
	viewTable->set(key("enable_noise"), valueBool(view->applyNoise));
	viewTable->set(key("enable_colorbleed"), valueBool(view->applyColorBleed));
	viewTable->set(key("enable_scanlines"), valueBool(view->applyScanlines));
	viewTable->set(key("enable_blur"), valueBool(view->applyBlur));
	viewTable->set(key("enable_glow"), valueBool(view->applyGlow));
	viewTable->set(key("enable_fringing"), valueBool(view->applyFringing));
	viewTable->set(key("enable_aperture"), valueBool(view->applyAperture));
}

bool FrameLoopState::hasActiveTick(const Runtime& runtime) const {
	return frameActive && runtime.m_luaInitialized && runtime.m_tickEnabled && !runtime.m_runtimeFailed;
}

void FrameLoopState::abandonFrameState(Runtime& runtime) {
	frameActive = false;
	runtime.vblank.abandonTick();
}

void FrameLoopState::finalizeUpdateSlice(Runtime& runtime) {
	if (runtime.m_pendingCall == Runtime::PendingCall::Entry && !runtime.vblank.tickCompleted()) {
		return;
	}
	abandonFrameState(runtime);
}

void FrameLoopState::executeUpdateCallback(Runtime& runtime) {
	try {
		while (true) {
			if (runtime.machine().cpu().isHaltedUntilIrq() && runtime.vblank.runHaltedUntilIrq(runtime, frameState)) {
				return;
			}
			if (runtime.vblank.consumeBackQueueClearAfterIrqWake()) {
				RenderQueues::clearBackQueues();
			}
			if (runtime.m_pendingCall != Runtime::PendingCall::Entry) {
				return;
			}
			const RunResult result = runtime.cpuExecution.runWithBudget(runtime, frameState);
			if (runtime.machine().cpu().isHaltedUntilIrq()) {
				if (runtime.vblank.runHaltedUntilIrq(runtime, frameState)) {
					return;
				}
				continue;
			}
			if (result == RunResult::Halted) {
				runtime.m_pendingCall = Runtime::PendingCall::None;
			}
			return;
		}
	} catch (const std::exception& e) {
		runtime.handleLuaError(e.what());
	}
}

bool FrameLoopState::tickUpdate(Runtime& runtime) {
	if (runtime.m_rebootRequested) {
		runtime.m_rebootRequested = false;
		runtime.frameScheduler.clearQueuedTime();
		if (!EngineCore::instance().rebootLoadedRom()) {
			EngineCore::instance().log(LogLevel::Error, "Runtime fault: reboot to bootrom failed.\n");
		}
		return true;
	}
	if (!runtime.m_luaInitialized || !runtime.m_tickEnabled || runtime.m_runtimeFailed) {
		return false;
	}

	runtime.cartBoot.prepareIfNeeded(runtime);
	if (runtime.cartBoot.pollSystemBootRequest(runtime)) {
		return true;
	}
	if (runtime.cartBoot.processPending(runtime)) {
		return true;
	}

	const bool previousFrameActive = frameActive;
	const int previousRemaining = previousFrameActive ? frameState.cycleBudgetRemaining : -1;
	const bool previousPending = runtime.m_pendingCall == Runtime::PendingCall::Entry;
	const i64 previousSequence = runtime.frameScheduler.lastTickSequence;
	const bool startedFrame = !frameActive;
	if (frameActive) {
		if (frameState.cycleBudgetRemaining <= 0 && !runtime.frameScheduler.refillFrameBudget(runtime, frameState)) {
			return false;
		}
	} else {
		if (!runtime.frameScheduler.startScheduledFrame(runtime)) {
			return false;
		}
	}

	if (runtime.m_pendingCall == Runtime::PendingCall::Entry) {
		executeUpdateCallback(runtime);
	}

	if (startedFrame) {
		auto key = [&runtime](std::string_view text) {
			return valueString(runtime.machine().cpu().internString(text));
		};
		auto* const gameTable = asTable(runtime.machine().cpu().getGlobalByKey(key("game")));
		auto* const viewTable = asTable(gameTable->get(key("view")));
		auto* const view = EngineCore::instance().view();
		auto readViewBool = [](Value value, const char* field) -> bool {
			if (!valueIsBool(value)) {
				throw BMSX_RUNTIME_ERROR(std::string("game.view.") + field + " must be boolean.");
			}
			return valueToBool(value);
		};
		view->crt_postprocessing_enabled = readViewBool(viewTable->get(key("crt_postprocessing_enabled")), "crt_postprocessing_enabled");
		view->applyNoise = readViewBool(viewTable->get(key("enable_noise")), "enable_noise");
		view->applyColorBleed = readViewBool(viewTable->get(key("enable_colorbleed")), "enable_colorbleed");
		view->applyScanlines = readViewBool(viewTable->get(key("enable_scanlines")), "enable_scanlines");
		view->applyBlur = readViewBool(viewTable->get(key("enable_blur")), "enable_blur");
		view->applyGlow = readViewBool(viewTable->get(key("enable_glow")), "enable_glow");
		view->applyFringing = readViewBool(viewTable->get(key("enable_fringing")), "enable_fringing");
		view->applyAperture = readViewBool(viewTable->get(key("enable_aperture")), "enable_aperture");
		runtime.m_debugUpdateCountTotal += 1;
	}

		frameState.updateExecuted = runtime.m_pendingCall != Runtime::PendingCall::Entry;
		runtime.machine().vdp().flushAssetEdits();
		finalizeUpdateSlice(runtime);
	const bool nextFrameActive = frameActive;
	if (nextFrameActive != previousFrameActive) {
		return true;
	}
	if (nextFrameActive && frameState.cycleBudgetRemaining != previousRemaining) {
		return true;
	}
		if ((runtime.m_pendingCall == Runtime::PendingCall::Entry) != previousPending) {
			return true;
		}
	return runtime.frameScheduler.lastTickSequence != previousSequence;
}

void FrameLoopState::runHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender) {
	EngineCore& engine = EngineCore::instance();
	if (engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) {
		return;
	}
	try {
		const auto tickStart = std::chrono::steady_clock::now();
		runtime.screen.recordHostFrame();
		engine.m_last_tick_timing.inputMs = 0.0;
		engine.m_last_tick_timing.workbenchModeInputMs = 0.0;
		engine.m_last_tick_timing.runtimeTerminalInputMs = 0.0;
		engine.m_last_tick_timing.runtimeUpdateMs = 0.0;
		engine.m_last_tick_timing.workbenchModeMs = 0.0;
		engine.m_last_tick_timing.runtimeTerminalMs = 0.0;
		engine.m_last_tick_timing.microtaskMs = 0.0;

		const double hostDeltaMs = std::min(deltaTime * 1000.0, MAX_FRAME_DELTA_MS);
		const double hostDeltaSeconds = hostDeltaMs / 1000.0;
		engine.m_delta_time = hostDeltaSeconds;
		engine.m_total_time += hostDeltaSeconds;
		engine.m_frame_count += 1;
		if (hostDeltaSeconds > 0.0) {
			engine.m_fps = 1.0 / hostDeltaSeconds;
		}

			const auto inputStart = std::chrono::steady_clock::now();
			Input::instance().pollInput();
			const auto inputEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.inputMs = to_ms(inputEnd - inputStart);

			runtime.screen.clearPresentation();
			if (!platformPaused) {
				const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
				const auto updateStart = std::chrono::steady_clock::now();
				engine.m_delta_time = runtime.timing.frameDurationMs / 1000.0;
				runtime.frameScheduler.run(runtime, hostDeltaMs);
				runtime.screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
				const auto updateEnd = std::chrono::steady_clock::now();
				engine.m_last_tick_timing.runtimeUpdateMs = to_ms(updateEnd - updateStart);

				const auto terminalStart = std::chrono::steady_clock::now();
				runtime.machine().vdp().flushAssetEdits();
				const auto terminalEnd = std::chrono::steady_clock::now();
				engine.m_last_tick_timing.runtimeTerminalMs = to_ms(terminalEnd - terminalStart);
			}
		engine.m_delta_time = hostDeltaSeconds;

		if (engine.m_platform && engine.m_platform->microtaskQueue()) {
			const auto microtaskStart = std::chrono::steady_clock::now();
			engine.m_platform->microtaskQueue()->flush();
			const auto microtaskEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.microtaskMs = to_ms(microtaskEnd - microtaskStart);
		}

		engine.m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
		if (!skipRender) {
			runtime.screen.render(engine, runtime);
		}
	} catch (const std::exception& e) {
		runtime.handleLuaError(e.what());
	}
}

} // namespace bmsx
