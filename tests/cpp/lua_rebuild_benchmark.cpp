#include "common/mmap_file.h"
#include "cartridge_media.h"
#include "machine/runtime/runtime.h"
#include "machine/cpu/native_compilation_profile.h"
#include "rompack/image.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"

#include <array>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string_view>

namespace {
using namespace bmsx;

class BenchmarkInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot& snapshot, InputControllerSampleContext) override { snapshot = {}; }
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

struct WorkRecord {
	DiagnosticCpuTiming cpu;
	DiagnosticGcProfile gc;
	i64 scheduledCycles;
	i64 ticks;
	int hostSteps;
	u64 prepares;
	u64 prepareNanoseconds;
	u64 compilationNanoseconds;
};
}

int main(int argc, char** argv) {
	try {
		if (argc != 4) throw std::runtime_error("Usage: lua_rebuild_benchmark BIOS CART normal|ctor|reuse");
		const std::string_view mode = argv[3];
		if (mode != "normal" && mode != "ctor" && mode != "reuse") throw std::runtime_error("unsupported mode (no GC stop primitive)");
		constexpr int warmup = 10, measured = 200;
		std::array<WorkRecord, warmup + measured> records{};
		MmapFile systemFile, cartFile;
		if (!systemFile.open(argv[1]) || !cartFile.open(argv[2])) throw std::runtime_error("cannot map input ROMs");
		const auto system = parseSystemRomImage(systemFile.data(), systemFile.size());
		const auto cart = parseCartridgePackage(cartFile.data(), cartFile.size());
		BenchmarkInput input;
		Runtime runtime({system.bytes, {cartridgeMediaFromPackage(cart), std::nullopt}, PSX_MACHINE_SPEC}, input);
		auto& cpu = runtime.machine.cpu;
		auto& scheduler = runtime.machine.scheduler;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		cpu.setNativeCompilationProfiling(true);
#endif
		runtime.boot();
		const auto readyKey = cpu.stringPool().intern("rebuild_ready", false);
		const auto modeKey = cpu.stringPool().intern("rebuild_mode", false);
		const auto requestedKey = cpu.stringPool().intern("rebuild_requested", false);
		const auto completedKey = cpu.stringPool().intern("rebuild_completed", false);
		const auto checksumKey = cpu.stringPool().intern("rebuild_checksum", false);

		// Actual BIOS/cart scheduling and device advancement. This workload never
		// reads rendered pixels: retire command-only output, rejecting readback.
		// Device work, audio output draining and inspection are OUTSIDE CPU clocks.
		const auto step = [&]() {
			auto& gpu = runtime.machine.gxGpu;
			double delta = runtime.timing.frameDurationMs;
			for (;;) {
				runtime.frameScheduler.run(runtime, delta);
				delta = 0;
				if (!gpu.backendServicePending()) break;
				if (!gpu.backendCommandDrainPending()) throw std::runtime_error("benchmark requires rendered readback");
				gpu.retireExecutedCommands();
				runtime.frameScheduler.synchronizeBackendService(runtime);
			}
			TickCompletion completion;
			while (runtime.frameScheduler.consumeTickCompletion(completion)) {}
			gpu.retirePresentedCommands();
			runtime.machine.audioController.synchronizeOutput().clear();
			if (runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) != 0) throw std::runtime_error("guest supervisor fault");
		};
		int bootSteps = 0;
		while (cpu.getGlobalByKey(readyKey) != valueBool(true) || !cpu.isHaltedUntilIrq()) {
			if (++bootSteps > 1000) throw std::runtime_error("cart did not reach ready halt");
			step();
		}
		cpu.setGlobalByKey(modeKey, valueString(cpu.stringPool().intern(mode)));
		for (int iteration = 1; iteration <= warmup + measured; ++iteration) {
			const auto before = scheduler.diagnosticCpuTiming;
			const auto gcBefore = cpu.diagnosticGcProfile();
			const auto cycleBefore = scheduler.nowCycles();
			const auto tickBefore = runtime.frameScheduler.lastTickSequence;
			NativeCompilationProfile compileBefore{}, compileAfter{};
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			compileBefore = cpu.readNativeCompilationProfile();
#endif
			cpu.setGlobalByKey(requestedKey, valueFromNumber(iteration));
			int steps = 0;
			do {
				if (++steps > 64) throw std::runtime_error("work unit exceeded 64 guest frames");
				step();
			} while (cpu.getGlobalByKey(completedKey) != valueFromNumber(iteration) || !cpu.isHaltedUntilIrq());
			const auto after = scheduler.diagnosticCpuTiming;
			const auto gcAfter = cpu.diagnosticGcProfile();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			compileAfter = cpu.readNativeCompilationProfile();
#endif
			if (cpu.getGlobalByKey(checksumKey) != valueFromNumber(4998675)) throw std::runtime_error("workload checksum mismatch");
			auto& r = records[iteration - 1];
			r.cpu = {after.slices - before.slices, after.consumedCycles - before.consumedCycles,
				after.wallNanoseconds - before.wallNanoseconds, after.threadNanoseconds - before.threadNanoseconds};
			r.gc.collections = gcAfter.collections - gcBefore.collections;
			r.gc.totalNanoseconds = gcAfter.totalNanoseconds - gcBefore.totalNanoseconds;
			r.scheduledCycles = scheduler.nowCycles() - cycleBefore;
			r.ticks = runtime.frameScheduler.lastTickSequence - tickBefore;
			r.hostSteps = steps;
			r.prepares = compileAfter.prepareRequests - compileBefore.prepareRequests;
			r.prepareNanoseconds = compileAfter.prepareNanoseconds - compileBefore.prepareNanoseconds;
			r.compilationNanoseconds = compileAfter.compilationNanoseconds - compileBefore.compilationNanoseconds;
			// Match PUC's untimed collect after ten warmups, using the existing
			// collector owner, without adding a cartridge API or a GC-off mode.
			if (iteration == warmup) cpu.collectHeap();
		}
		std::cout << std::setprecision(17)
			<< "{\"mode\":\"" << mode << "\",\"warmup\":" << warmup << ",\"measured\":" << measured
			<< ",\"guestFrameBudget\":" << runtime.timing.cycleBudgetPerFrame
			<< ",\"guestFrameMs\":" << runtime.timing.frameDurationMs
			<< ",\"bootSteps\":" << bootSteps << ",\"checksum\":4998675}\n";
		for (size_t i = 0; i < records.size(); ++i) {
			const auto& r = records[i];
			std::cout << "{\"iteration\":" << i + 1 << ",\"measured\":" << (i >= warmup ? "true" : "false")
				<< ",\"cpuThreadNs\":" << r.cpu.threadNanoseconds << ",\"cpuWallNs\":" << r.cpu.wallNanoseconds
				<< ",\"guestCycles\":" << r.cpu.consumedCycles << ",\"cpuSlices\":" << r.cpu.slices
				<< ",\"scheduledCycles\":" << r.scheduledCycles << ",\"ticks\":" << r.ticks << ",\"hostSteps\":" << r.hostSteps
				<< ",\"gcCollections\":" << r.gc.collections << ",\"gcWallNs\":" << r.gc.totalNanoseconds
				<< ",\"prepares\":" << r.prepares << ",\"prepareNs\":" << r.prepareNanoseconds
				<< ",\"compilationNs\":" << r.compilationNanoseconds << "}\n";
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
