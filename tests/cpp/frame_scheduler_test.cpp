#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/cpu/execution_image.h"
#include "common/endian.h"
#include "spec/audio/apu.h"
#include "machine/devices/input/contracts.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/scheduler/frame.h"
#include "render/backend/backend.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "spec/gx/pcrtc.h"
#include "spec/gx/gp0.h"
#include "support/boot_rom_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/blua32_test_rom.h"
#include "support/cpu_execution_parity.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace {

constexpr bmsx::u32 TEST_KEY_USAGE = 59u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class TickInputSource final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(
		bmsx::InputControllerSnapshot& snapshot,
		bmsx::InputControllerSampleContext) override {
		require(!rejectLiveInput, "replay cannot sample live input");
		sampleCount += 1;
		if (keyDown) {
			snapshot.keyWords[TEST_KEY_USAGE >> 5u] |= 1u << (TEST_KEY_USAGE & 31u);
		}
	}

	auto supervisorRequestLineHigh() const -> bool override {
		require(!rejectLiveInput, "replay cannot read the live supervisor line");
		return supervisorHigh;
	}

	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {
	}

	int sampleCount = 0;
	bool keyDown = false;
	bool supervisorHigh = false;
	bool rejectLiveInput = false;
};

struct TickRuntimeFixture {
	std::vector<bmsx::u8> systemRom = bmsx::test::makeMinimalBootRom(
		bmsx::RomImageDomain::System
	);
	TickInputSource input;
	bmsx::Runtime runtime;

	TickRuntimeFixture(const bmsx::CartridgeSocketMediaPair& slots = bmsx::test::cartridgeSlots())
		: runtime(
			bmsx::RuntimeOptions{
				systemRom,
				slots,
				bmsx::PSX_MACHINE_SPEC,
			},
			input
		) {
		runtime.boot();
	}
};

void testSupervisorGpuServiceAtDeviceBoundaries() {
	using namespace bmsx;
	for (const bool dmaUpload : {false, true}) {
		TickRuntimeFixture fixture;
		auto& runtime = fixture.runtime;
		auto& gpu = runtime.machine.gxGpu;
		auto& memory = runtime.machine.memory;
		auto& system = runtime.machine.systemController;
		auto& dma = runtime.machine.dmaController;
		auto& scheduler = runtime.frameScheduler;
		SoftwareBackend backend(16, 2, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const std::array<u32, 3> words{0x020000ffu, 0u, 0x00020010u};
		if (dmaUpload) {
			const u32 source = RAM_BASE + 0x20000;
			memory.writeMappedU32LE(IO_GX_GPU_GP1, 0x04000002);
			for (size_t index = 0; index < words.size(); ++index) memory.writeMappedU32LE(source + index * 4, words[index]);
			memory.writeMappedU32LE(IO_DMA0_READ_ADDR, source);
			memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, static_cast<u32>(words.size()));
			memory.writeMappedU32LE(IO_DMA0_CONTROL, 1); // RAM -> GP0
			memory.writeMappedU32LE(IO_DMA0_TRIGGER, 1);
		} else for (const u32 word : words) memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
		memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT);
		if (dmaUpload) {
			const auto burst = dma.captureState().scheduledBlockCycles;
			require(burst == 7, "three RAM reads and GP0 writes retain their serial bus charge");
			scheduler.runDevicesToNextLogicalTick(runtime, burst - 1);
			require(dma.hasAdmittedWriteBlock(IO_GX_GPU_GP0), "the admitted DMA burst has not completed early");
			require(!gpu.captureState().supervisorIngressQuiesceRequested, "GPU quiescence waits for the admitted bus work");
			require(!gpu.backendServicePending() && gpu.readDeviceOutput().commandBuffer.commandCount == 0,
				"unpublished DMA data cannot request backend execution");
			scheduler.runDevicesToNextLogicalTick(runtime, 1);
			require(!dma.hasAdmittedWriteBlock(IO_GX_GPU_GP0), "the last bus cycle releases the admitted burst");
		}
		const auto completion = gpu.captureState().pendingCommandCycles;
		require(completion > 1, "the fill has a future command deadline");
		scheduler.runDevicesToNextLogicalTick(runtime, completion - 1);
		require(!gpu.backendServicePending() && system.cpuHeld(), "accepted drawing does not complete early at quiescence");
		scheduler.runDevicesToNextLogicalTick(runtime, 1);
		const auto completedAt = runtime.machine.scheduler.nowCycles();
		require(gpu.readDeviceOutput().commandBuffer.commandCount == 1 && gpu.backendCommandDrainPending(),
			"one completed command is sufficient at the GPU boundary");
		scheduler.runDevicesToNextLogicalTick(runtime, 19);
		require(runtime.machine.scheduler.nowCycles() == completedAt, "backend latency does not spend guest cycles");
		unsigned drains = 0;
		while (gpu.backendServicePending()) {
			require(gpu.backendCommandDrainPending(), "the live host service loop selects the completed command prefix");
			backend.executeGxGpuCommandDrain(gpu);
			++drains;
		}
		require(drains == 1, "the completed subcapacity prefix is submitted once");
		scheduler.synchronizeBackendService(runtime);
		scheduler.runDevicesToNextLogicalTick(runtime, 0);
		require(!system.cpuHeld() && system.supervisorContextActive(), "service releases supervisor context entry");
		require(runtime.machine.scheduler.nowCycles() == completedAt + 19, "only the retained grant resumes");
		require(scheduler.lastTickSequence == 0, "supervisor entry does not wait for presentation");
		backend.captureGxGpuVramSnapshot(gpu);
		require(gpu.readVramSnapshotBytes()[0] == 31, "the actual backend executes the completed fill before takeover");

		// LEAVE has the same GPU boundary for supervisor work.
		for (const u32 word : {0x0200ff00u, 0u, 0x00020010u}) memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
		memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_LEAVE);
		const auto leaveCycles = gpu.captureState().pendingCommandCycles;
		scheduler.runDevicesToNextLogicalTick(runtime, leaveCycles + 1);
		require(gpu.backendCommandDrainPending() && system.cpuHeld(), "LEAVE also waits for completed supervisor drawing");
		while (gpu.backendServicePending()) backend.executeGxGpuCommandDrain(gpu);
		scheduler.synchronizeBackendService(runtime);
		scheduler.runDevicesToNextLogicalTick(runtime, 0);
		require(!system.supervisorContextActive(), "backend service releases the return to USER");
		backend.captureGxGpuVramSnapshot(gpu);
		require(readLE32(gpu.readVramSnapshotBytes().data()) == 0x03e003e0, "supervisor pixels persist in shared VRAM");
	}
}

void testSupervisorServiceBanksUnreadReadback() {
	using namespace bmsx;
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& gpu = runtime.machine.gxGpu;
	auto& memory = runtime.machine.memory;
	auto& system = runtime.machine.systemController;
	auto& scheduler = runtime.frameScheduler;
	SoftwareBackend backend(16, 2, PSX_MACHINE_SPEC.gxGpuVramBytes);
	std::vector<u8> bytes(PSX_MACHINE_SPEC.gxGpuVramBytes);
	const std::array<u8, 10> samples{0x11, 0x11, 0x22, 0x22, 0x33, 0x33, 0x44, 0x44, 0x55, 0x55};
	std::copy(samples.begin(), samples.end(), bytes.begin());
	gpu.replaceVramSnapshotBytes(bytes);
	for (const u32 word : {0xc0000000u, 0u, 0x00010005u}) memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
	const auto completion = gpu.captureState().pendingCommandCycles;
	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT);
	scheduler.runDevicesToNextLogicalTick(runtime, completion + 9);
	auto& readback = gpu.readDeviceOutput().readbackPort;
	require(readback.phase() == GX_GPU_READBACK_PENDING && !gpu.backendCommandDrainPending(),
		"readback must produce its bytes before retirement");
	unsigned readbacks = 0, drains = 0;
	while (gpu.backendServicePending()) {
		if (gpu.backendCommandDrainPending()) {
			require(readback.phase() == GX_GPU_READBACK_READY && readback.pixelCursor() == 0,
				"retirement must not consume guest pixels");
			backend.executeGxGpuCommandDrain(gpu);
			++drains;
		} else {
			backend.executeGxGpuReadback(gpu);
			++readbacks;
		}
	}
	require(readbacks == 1 && drains == 1, "the ordinary service loop completes and retires the readback fence once");
	scheduler.synchronizeBackendService(runtime);
	scheduler.runDevicesToNextLogicalTick(runtime, 0);
	require(!system.cpuHeld() && readback.phase() == GX_GPU_READBACK_IDLE, "supervisor starts with empty active readback");
	const auto state = gpu.captureState();
	require(state.userIngressContext.readbackPhase == GX_GPU_READBACK_READY && state.userIngressContext.readbackPixelCursor == 0,
		"USER retains all completed unread pixels at context entry");
	memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_LEAVE);
	scheduler.runDevicesToNextLogicalTick(runtime, 1);
	require(!system.supervisorContextActive() && readback.phase() == GX_GPU_READBACK_READY, "LEAVE restores the completed USER result");
	require(memory.readMappedU32LE(IO_GX_GPU_GP0) == 0x22221111u, "the first unread pixel pair is unchanged");
	require(memory.readMappedU32LE(IO_GX_GPU_GP0) == 0x44443333u, "the next unread pair is unchanged");
	require(memory.readMappedU32LE(IO_GX_GPU_GP0) == 0x5555u, "the odd final pixel is unchanged");
	require(readback.phase() == GX_GPU_READBACK_IDLE && scheduler.lastTickSequence == 0,
		"only guest reads consume the result, without a presentation edge");
}

void testBusyCpuBudgetAtVblank() {
	bmsx::test::Blua32TestImage image;
	image.text.resize(bmsx::INSTRUCTION_BYTES);
	bmsx::writeInstruction(image.text, 0, static_cast<bmsx::u8>(bmsx::OpCode::JMP), 0, 63, 63, 255);
	image.functions.push_back({.firstWord = 0, .wordCount = 1});
	for (const auto& primitive : bmsx::LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	const auto system = bmsx::test::encodeBlua32TestRom(bmsx::RomImageDomain::System, image);
	TickInputSource input;
	bmsx::Runtime runtime({system.bytes, bmsx::test::cartridgeSlots(), bmsx::PSX_MACHINE_SPEC}, input);
	runtime.boot();
	auto& scheduler = runtime.frameScheduler;
	require(scheduler.runToNextLogicalTick(runtime), "busy execution reaches VBlank");
	require(scheduler.lastTickBudgetGranted - scheduler.lastTickCpuUsedCycles == scheduler.lastTickBudgetRemaining,
		"VBlank reads the consumed CPU budget before carrying the remainder");
	require(scheduler.lastTickCpuUsedCycles == runtime.machine.scheduler.nowCycles(), "busy CPU cycles match machine time");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(runtime.machine.scheduler.diagnosticCpuSliceCount > 0
		&& runtime.machine.scheduler.diagnosticCpuSliceConsumedCycles == scheduler.lastTickCpuUsedCycles,
		"CPU-slice diagnostics account for the busy loop's execution");
#endif
	require(scheduler.captureState().carriedCycleBudget == scheduler.lastTickBudgetRemaining, "only unspent cycles carry");

	const auto before = runtime.machine.scheduler.nowCycles();
	const auto carry = scheduler.lastTickBudgetRemaining;
	scheduler.run(runtime, 40.0);
	require(runtime.machine.scheduler.nowCycles() - before == carry + 40 * runtime.timing.cpuCyclesPerMillisecond,
		"busy execution consumes exactly its host grant across VBlank edges");
	require(runtime.frameLoop.frameState.cycleBudgetRemaining == 0, "the grant is consumed");
	const auto pausedAt = runtime.machine.scheduler.nowCycles();
	scheduler.run(runtime, 0.0);
	require(runtime.machine.scheduler.nowCycles() == pausedAt, "a busy loop cannot invent a new host grant");
	scheduler.stepInstruction(runtime, 1.0);
	const auto& frame = runtime.frameLoop.frameState;
	require(frame.cycleBudgetGranted - frame.activeCpuUsedCycles == frame.cycleBudgetRemaining,
		"instruction stepping updates the same budget owner");
}

void testDmaSharedBusStopsCpu() {
	using namespace bmsx;
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMP), 0, 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0, 0);
	image.functions.push_back({.firstWord = 0, .wordCount = 2});
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, image);
	TickInputSource input;
	Runtime runtime({system.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
	runtime.boot();
	auto& memory = runtime.machine.memory;
	auto& cpu = runtime.machine.cpu;
	auto& dma = runtime.machine.dmaController;
	const u32 source = RAM_BASE + 0x20000, target = RAM_BASE + 0x21000;
	memory.writeMappedU32LE(source, 0x12345678);
	memory.writeMappedU32LE(IO_DMA0_READ_ADDR, source);
	memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, target);
	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 256);
	memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x00000000);
	memory.writeMappedU32LE(IO_DMA0_TRIGGER, 1);
	const int depth = static_cast<int>(cpu.activeThread()->frameDepth) - 1;
	const u32 pc = cpu.readFramePc(depth);
	require(dma.captureState().scheduledBlockCycles == 514, "both serial RAM sides occupy 257 bus cycles");
	runtime.frameScheduler.runCyclesToNextLogicalTick(runtime, 513);
	require(cpu.readFramePc(depth) == pc && dma.cpuBusHeld(), "CPU instructions wait while DMA owns the bus");
	require(memory.readMappedU32LE(target) == 0, "block data is not published early");
	runtime.frameScheduler.runCyclesToNextLogicalTick(runtime, 1);
	require(memory.readMappedU32LE(target) == 0x12345678 && !dma.cpuBusHeld(), "DMA publishes data then releases the bus");
	require(cpu.readFramePc(depth) == pc, "no instruction is charged to the final DMA cycle");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(runtime.machine.scheduler.diagnosticCpuSliceCount == 0
		&& runtime.machine.scheduler.diagnosticCpuSliceConsumedCycles == 0,
		"CPU-slice diagnostics exclude all 514 DMA-held cycles");
#endif
	runtime.frameScheduler.runCyclesToNextLogicalTick(runtime, 1);
	require(cpu.readFramePc(depth) != pc, "CPU instruction execution resumes after the burst");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(runtime.machine.scheduler.diagnosticCpuSliceCount == 1
		&& runtime.machine.scheduler.diagnosticCpuSliceConsumedCycles == 1,
		"CPU-slice diagnostics count only the resumed instruction");
#endif
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void testWarmedGeneratedDmaSharedBus() {
	using namespace bmsx;
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (u8 word = 0; word < 5; ++word) {
		writeInstruction(image.text, word, static_cast<u8>(OpCode::STORE_MEM_D), word, 5,
			static_cast<u8>(MemoryAccessKind::U32LE), word == 4 ? 5 : word);
	}
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::LOAD_MEM), 7, 1, static_cast<u8>(MemoryAccessKind::U32LE));
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::ADD), 6, 6, 4);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 56, 255); // -8 words
	image.functions.push_back({.firstWord = 0, .wordCount = 8, .maxStack = 8});
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	const auto system = test::encodeBlua32TestRom(RomImageDomain::System, image);
	TickInputSource generatedInput, referenceInput;
	Runtime generated({system.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, generatedInput);
	Runtime reference({system.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, referenceInput);
	generated.boot(); reference.boot();
	// The existing observation route is the scalar C++ reference, not another native cache.
	reference.machine.cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; },
		nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	const std::array<Runtime*, 2> runtimes{&generated, &reference};
	const u32 source = RAM_BASE + 0x20000, target = RAM_BASE + 0x21000;
	const u32 entry = system.textAddress;
	constexpr int warmBursts = NATIVE_BLOCK_COMPILATION_THRESHOLD + 8;
	for (auto* runtime : runtimes) {
		auto& frame = *runtime->machine.cpu.activeThread()->frameAtDepth(0);
		const std::array<u32, 8> values{source, target, 256, 0, 1, IO_DMA0_READ_ADDR, 0, 0};
		for (size_t index = 0; index < values.size(); ++index) frame.registers[index] = valueNumber(values[index]);
		for (u32 word = 0; word < 256; ++word) runtime->machine.memory.writeMappedU32LE(source + word * 4, 0x12340000 + word);
		// Five MMIO stores, 514 bus cycles, then load/add/backedge.
		const int loopCycles = 5 * BASE_CYCLES[static_cast<u8>(OpCode::STORE_MEM_D)] + 514
			+ BASE_CYCLES[static_cast<u8>(OpCode::LOAD_MEM)] + BASE_CYCLES[static_cast<u8>(OpCode::ADD)]
			+ BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
		runtime->frameScheduler.runCyclesToNextLogicalTick(*runtime, warmBursts * loopCycles);
		require(frame.pc == entry && frame.registers[6] == valueNumber(warmBursts), "the real DMA loop warms through its admitted bursts");
	}
	auto& generatedFrame = *generated.machine.cpu.activeThread()->frameAtDepth(0);
	const auto& page = *generatedFrame.decodedPage;
	const u32 triggerWord = ((entry & MAPPED_PAGE_BYTE_MASK) >> 2u) + 4u;
	test::waitForNativeEntry(generated.machine.cpu, page, triggerWord);
	require(page.nativeBlocks && page.nativeBlocks->entries[triggerWord] && page.nativeCode[triggerWord],
		"the DMA trigger has a warmed native entry before the exclusion probes");
	const auto& trigger = *page.nativeBlocks->entries[triggerWord];
	require(std::any_of(trigger.sideExits.begin(), trigger.sideExits.end(), [entry](const auto& exit) {
		return exit.exit == NativeBlockExit::WriteMemory && exit.currentPc == entry + 16;
	}), "the generated trigger retains the actual MMIO owner exit");
	require(!reference.machine.cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks,
		"the reference remains interpreter-only");
	const auto run = [&](i64 grant) {
		for (auto* runtime : runtimes) runtime->frameScheduler.runCyclesToNextLogicalTick(*runtime, grant);
		require(encodeRuntimeSaveState(captureRuntimeSaveState(generated)) == encodeRuntimeSaveState(captureRuntimeSaveState(reference)),
			"generated and scalar machines agree at the same DMA boundary");
	};
	for (u32 iteration = 0; iteration < 2; ++iteration) {
		for (auto* runtime : runtimes) for (u32 word = 0; word < 256; ++word) {
			runtime->machine.memory.writeMappedU32LE(source + word * 4, 0x43210000 + iteration * 256 + word);
			runtime->machine.memory.writeMappedU32LE(target + word * 4, 0);
		}
		run(5 * BASE_CYCLES[static_cast<u8>(OpCode::STORE_MEM_D)] + 1); // TRIGGER yields before the following load.
		auto& memory = generated.machine.memory;
		auto& dma = generated.machine.dmaController;
		require(generatedFrame.pc == entry + 20 && generatedFrame.registers[6] == valueNumber(warmBursts + iteration),
			"the generated DMA-trigger store yields before its following load or counter update");
		require(dma.cpuBusHeld() && dma.captureState().scheduledBlockCycles == 513, "the real DMA owns the remaining bus interval");
		run(512);
		require(generatedFrame.pc == entry + 20 && dma.cpuBusHeld(), "native execution stays excluded until burst completion");
		for (u32 word = 0; word < 256; ++word) require(memory.readMappedU32LE(target + word * 4) == 0, "no DMA word is published early");
		run(1);
		require(generatedFrame.pc == entry + 20 && !dma.cpuBusHeld(), "the final DMA cycle cannot also execute the continuation");
		for (u32 word = 0; word < 256; ++word) require(memory.readMappedU32LE(target + word * 4) == 0x43210000 + iteration * 256 + word,
			"the completed burst publishes every raw source word");
		run(BASE_CYCLES[static_cast<u8>(OpCode::LOAD_MEM)] + BASE_CYCLES[static_cast<u8>(OpCode::ADD)]
			+ BASE_CYCLES[static_cast<u8>(OpCode::JMP)]);
		require(generatedFrame.pc == entry && generatedFrame.registers[6] == valueNumber(warmBursts + 1 + iteration), "generated execution resumes exactly once after bus release");
		require(generatedFrame.registers[7] == valueNumber(0x43210000 + iteration * 256), "the resumed load observes DMA output");
	}
}
#endif

void testDeviceSettlementRetainsCpuStop() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& scheduler = runtime.frameScheduler;
	auto& cpu = runtime.machine.cpu;
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	auto* thread = cpu.activeThread();
	const auto depth = thread->frameDepth;
	const auto pc = thread->currentFrame->pc;
	const auto stackTop = thread->stackTop;
	require(!scheduler.runDevicesToNextLogicalTick(runtime, 19), "partial device grant stops before VBlank");
	require(runtime.machine.scheduler.nowCycles() == 19, "devices consume the exact partial grant");
	require(scheduler.runDevicesToNextLogicalTick(runtime, runtime.timing.cycleBudgetPerFrame), "device timers reach the real video edge");
	require(scheduler.lastTickSequence == 1 && fixture.input.sampleCount == 1, "VBlank publishes its ordinary tick and input sample");
	require((runtime.machine.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0, "VBlank latches its pending IRQ");
	require(cpu.activeThread() == thread && thread->frameDepth == depth && thread->currentFrame->pc == pc && thread->stackTop == stackTop,
		"device settlement neither executes the stopped CPU nor enters its pending interrupt");
	require(scheduler.lastTickCpuUsedCycles == 0, "device cycles are not CPU execution");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(runtime.machine.scheduler.diagnosticCpuSliceCount == 0
		&& runtime.machine.scheduler.diagnosticCpuSliceConsumedCycles == 0,
		"device settlement does not manufacture CPU-slice consumption");
#endif
	require(scheduler.lastTickBudgetGranted - scheduler.lastTickBudgetRemaining == runtime.machine.scheduler.nowCycles(), "only unspent device budget carries");
}

void testDeviceSettlementBackendFence() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& scheduler = runtime.frameScheduler;
	auto& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u); gpu.writeGp0(0); gpu.writeGp0(0x00010001);
	require(!scheduler.runDevicesToNextLogicalTick(runtime, 55), "device settlement suspends at the backend fence");
	const auto& output = gpu.readDeviceOutput();
	auto& readback = output.readbackPort;
	require(readback.claimReadback(output.commandBuffer.executedCommandCount), "backend claims readback");
	const auto blockedAt = runtime.machine.scheduler.nowCycles();
	require(!scheduler.runDevicesToNextLogicalTick(runtime, 149), "admission retains a second split grant during service");
	require(runtime.machine.scheduler.nowCycles() == blockedAt && runtime.frameLoop.frameState.cycleBudgetGranted == 204, "backend latency consumes no granted cycles");
	readback.completeReadback(readback.token());
	require(!scheduler.runDevicesToNextLogicalTick(runtime, 0), "zero resumes retained work without reaching VBlank");
	require(runtime.machine.scheduler.nowCycles() == 204 && runtime.frameLoop.frameState.cycleBudgetRemaining == 0, "split grants remain exact across backend service");
	require(runtime.frameLoop.frameState.activeCpuUsedCycles == 0, "backend settlement executes no CPU instructions");
}

void testBoundedLogicalTickRetainsCycleCarry() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	const bmsx::f64 partialDeltaMs = runtime.timing.frameDurationMs / 4.0;

	scheduler.run(runtime, partialDeltaMs);
	require(scheduler.lastTickSequence == 0, "partial host delta stops before VBlank");
	require(runtime.frameLoop.frameActive, "partial host delta retains the in-flight frame");
	const bmsx::i64 partialBudget = runtime.frameLoop.frameState.cycleBudgetGranted;
	const bmsx::f64 grantRemainder = scheduler.captureState().cycleGrantRemainder;
	const bmsx::i64 firstTickBudget = runtime.timing.cycleBudgetPerFrame;

	require(scheduler.runToNextLogicalTick(runtime), "bounded execution reaches the next logical tick");
	require(scheduler.lastTickSequence == 1, "bounded execution advances exactly one tick sequence");
	require(
		scheduler.lastTickBudgetGranted == partialBudget + firstTickBudget,
		"bounded execution extends the active frame by one PCRTC tick budget"
	);
	require(
		scheduler.captureState().cycleGrantRemainder == grantRemainder,
		"bounded execution does not consume the host grant remainder"
	);
	require(
		scheduler.captureState().carriedCycleBudget == scheduler.lastTickBudgetRemaining,
		"the unused whole-cycle budget remains scheduler carry"
	);
	const bmsx::i64 carriedBudget = scheduler.lastTickBudgetRemaining;

	require(scheduler.runToNextLogicalTick(runtime), "a second bounded execution reaches the following tick");
	require(scheduler.lastTickSequence == 2, "each bounded execution advances one monotone tick");
	require(
		scheduler.lastTickBudgetGranted == carriedBudget + firstTickBudget,
		"the next explicit grant is distinct from retained whole-cycle carry"
	);
	require(
		runtime.frameLoop.frameState.cycleCarryGranted == carriedBudget,
		"frame telemetry records only previously retained cycles as carry"
	);
	require(
		scheduler.lastTickBudgetRemaining == carriedBudget,
		"successive tick grants preserve the existing beam-phase carry"
	);
	require(
		scheduler.captureState().cycleGrantRemainder == grantRemainder,
		"successive bounded execution leaves host fractional time unchanged"
	);
}

void testBoundedLogicalTickResumesBackendFenceWithoutAnotherGrant() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);

	require(!scheduler.runToNextLogicalTick(runtime), "backend fence suspends bounded execution");
	require(gpu.backendServiceBlocksMachine(), "scheduled GPUREAD reaches the backend fence");
	require(scheduler.lastTickSequence == 0, "backend fence precedes the target VBlank");
	require(
		runtime.frameLoop.frameState.cycleBudgetGranted == runtime.timing.cycleBudgetPerFrame,
		"bounded execution grants one PCRTC period before suspension"
	);
	const bmsx::FrameSchedulerStateSnapshot suspendedState = scheduler.captureState();
	require(suspendedState.logicalTickRunPending, "bounded operation retains its pending state");
	require(suspendedState.logicalTickRunTargetSequence == 1, "bounded operation retains its VBlank target");

	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	require(
		readback.claimReadback(output.commandBuffer.executedCommandCount),
		"backend claims the readback fence"
	);
	readback.completeReadback(readback.token());
	require(scheduler.runToNextLogicalTick(runtime), "bounded execution resumes after backend service");
	require(scheduler.lastTickSequence == 1, "resumed execution reaches its original target");
	require(
		scheduler.lastTickBudgetGranted == runtime.timing.cycleBudgetPerFrame,
		"resumption does not grant a second PCRTC period"
	);
	const bmsx::FrameSchedulerStateSnapshot completedState = scheduler.captureState();
	require(!completedState.logicalTickRunPending, "completed operation clears its pending state");
	require(completedState.logicalTickRunTargetSequence == 0, "completed operation clears its target");
}

void testRawCycleGrantsStayExactAcrossSplitAdmissionAndPacedCarry() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& scheduler = runtime.frameScheduler;
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 0), "zero without retained work does not complete a tick");
	require(!runtime.frameLoop.frameActive, "zero without retained work opens no frame");
	constexpr std::array<bmsx::i64, 3> grants = {55, 149, 220};
	bmsx::i64 total = 0;
	for (const auto grant : grants) {
		total += grant;
		require(!scheduler.runCyclesToNextLogicalTick(runtime, grant), "small raw grants stop before VBlank");
		require(runtime.frameLoop.frameState.cycleBudgetGranted == total, "split raw admission retains exact integer grants");
		require(runtime.frameLoop.frameState.cycleBudgetRemaining == 0, "small grants are exhausted");
		require(scheduler.captureState().cycleGrantRemainder == 0.0, "raw cycles never enter fractional pacing");
	}
	scheduler.run(runtime, 0.5 / runtime.timing.cpuCyclesPerMillisecond);
	const auto remainder = scheduler.captureState().cycleGrantRemainder;
	require(remainder == 0.5, "paced execution retains a fractional cycle");
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 55), "raw admission resumes the partial frame");
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 479, "the explicit grant is exact beside paced fractional carry");
	require(scheduler.captureState().cycleGrantRemainder == remainder, "raw admission leaves paced fractional carry unchanged");
	scheduler.run(runtime, 0.5 / runtime.timing.cpuCyclesPerMillisecond);
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 480, "paced execution retains its own fractional carry");
}

void testRawCycleGrantExceedsPacedLimitsAndResumesRetainedTicks() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& scheduler = runtime.frameScheduler;
	const bmsx::i64 grant = bmsx::PSX_CPU_FREQ_HZ;
	require(scheduler.runCyclesToNextLogicalTick(runtime, grant), "large raw grant reaches the first tick");
	require(scheduler.lastTickSequence == 1, "raw execution exposes only one tick");
	require(scheduler.lastTickBudgetGranted == grant, "the explicit grant is not clamped by paced catch-up");
	require(scheduler.captureState().carriedCycleBudget == grant - runtime.machine.scheduler.nowCycles(), "every unspent raw cycle carries");
	bool completed = true;
	for (int step = 0; completed && step < 100; ++step) {
		const auto before = scheduler.lastTickSequence;
		const auto carry = scheduler.captureState().carriedCycleBudget;
		completed = scheduler.runCyclesToNextLogicalTick(runtime, 0);
		require(scheduler.lastTickSequence == before + (completed ? 1 : 0), "each resume exposes at most one retained tick");
		require(runtime.frameLoop.frameState.cycleBudgetGranted == carry, "zero-grant resumption admits no extra cycles");
	}
	require(!completed, "the original grant is exhausted");
	require(runtime.machine.scheduler.nowCycles() == grant, "all explicit cycles execute");
	require(runtime.frameLoop.frameState.cycleBudgetRemaining == 0, "no active budget remains");
	require(scheduler.captureState().carriedCycleBudget == 0, "no carried budget remains");
	require(scheduler.captureState().cycleGrantRemainder == 0.0, "raw grants produce no fractional pacing carry");
}

void testRawCycleAdmissionRetainsSplitGrantsDuringSubmittedReadback() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& scheduler = runtime.frameScheduler;
	auto& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0(0x00010001u);
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 55), "readback suspends raw execution");
	const auto& output = gpu.readDeviceOutput();
	auto& readback = output.readbackPort;
	require(readback.claimReadback(output.commandBuffer.executedCommandCount), "backend submits the readback");
	const auto blockedAt = runtime.machine.scheduler.nowCycles();
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 149), "new admission does not complete blocked execution");
	require(runtime.machine.scheduler.nowCycles() == blockedAt, "admission does not advance blocked hardware");
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 204, "split explicit grants are retained during backend work");
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 0), "zero grant waits for submitted work");
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 204, "waiting does not regrant cycles");
	readback.completeReadback(readback.token());
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 0), "completed readback resumes only accepted work");
	require(runtime.machine.scheduler.nowCycles() == 204, "both explicit grants execute after completion");
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 204, "resumption does not duplicate the explicit grants");
	require(runtime.frameLoop.frameState.cycleBudgetRemaining == 0, "the accepted grant is exhausted");
	require(scheduler.captureState().cycleGrantRemainder == 0.0, "readback resumption does not enter fractional pacing");
}

void testRawCycleAdmissionDoesNotQueueWhileHistoryHoldsExecution() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& scheduler = runtime.frameScheduler;
	runtime.history.mode = bmsx::HistoryMode::Reviewing;
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 55), "history review blocks raw admission");
	require(!runtime.frameLoop.frameActive, "history review opens no frame");
	runtime.history.mode = bmsx::HistoryMode::Disabled;
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 55), "small grant stops before VBlank");
	runtime.history.checkpointPending = true;
	require(!scheduler.runCyclesToNextLogicalTick(runtime, 149), "pending checkpoint blocks raw admission");
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 55, "history hold queues no explicit grant");
	require(runtime.machine.scheduler.nowCycles() == 55, "history hold advances no hardware");
}

void testScheduledBoundedTickRetainsPartialMachineProgress() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	const bmsx::f64 halfFrameMs = runtime.timing.frameDurationMs / 2.0;

	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, 0.0),
		"scheduled bounded execution requires host time"
	);
	require(!runtime.frameLoop.frameActive, "zero host time does not open a machine frame");
	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, halfFrameMs),
		"a partial host frame stops before VBlank"
	);
	require(scheduler.lastTickSequence == 0, "partial host time does not publish a logical tick");
	require(runtime.frameLoop.frameActive, "partial host time retains the machine frame");
	require(
		scheduler.runScheduledToNextLogicalTick(runtime, halfFrameMs),
		"the next host delta completes the retained machine frame"
	);
	require(scheduler.lastTickSequence == 1, "scheduled bounded execution publishes one tick");
	require(
		scheduler.lastTickBudgetGranted == static_cast<bmsx::i64>(
			runtime.timing.frameDurationMs * runtime.timing.cpuCyclesPerMillisecond
		),
		"scheduled bounded execution grants only accepted host time"
	);
}

void testScheduledBoundedTickExposesEveryCatchUpBoundary() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	const bmsx::f64 hostDeltaMs = runtime.timing.frameDurationMs * 4.0;

	for (bmsx::i64 expectedSequence = 1; expectedSequence <= 4; ++expectedSequence) {
		fixture.input.keyDown = (expectedSequence & 1) != 0;
		runtime.machine.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
		require(
			scheduler.runScheduledToNextLogicalTick(
				runtime,
				expectedSequence == 1 ? hostDeltaMs : 0.0
			),
			"retained host carry reaches the next prepared boundary"
		);
		require(
			scheduler.lastTickSequence == expectedSequence,
			"scheduled bounded execution exposes each logical tick"
		);
	}
	require(fixture.input.sampleCount == 4, "each catch-up boundary samples ICU input once");
	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, 0.0),
		"drained host carry cannot fabricate another logical tick"
	);
}

void testScheduledBoundedTickResumesBackendFenceWithAcceptedHostGrant() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);

	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, runtime.timing.frameDurationMs),
		"backend fence suspends scheduled bounded execution"
	);
	require(gpu.backendServiceBlocksMachine(), "scheduled execution reaches the backend fence");
	const bmsx::i64 grantedBudget = runtime.frameLoop.frameState.cycleBudgetGranted;
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	require(
		readback.claimReadback(output.commandBuffer.executedCommandCount),
		"backend claims the scheduled readback fence"
	);
	readback.completeReadback(readback.token());
	require(
		scheduler.runScheduledToNextLogicalTick(runtime, 0.0),
		"scheduled bounded execution resumes without another host delta"
	);
	require(scheduler.lastTickSequence == 1, "resumed scheduled execution reaches its target");
	require(
		scheduler.lastTickBudgetGranted == grantedBudget,
		"backend resumption preserves the accepted host grant"
	);
}

void testBackendCompletionAtVblankDoesNotExecuteAnotherTick() {
	TickRuntimeFixture baseline;
	require(baseline.runtime.frameScheduler.runToNextLogicalTick(baseline.runtime), "baseline reaches VBlank");
	const auto edge = baseline.runtime.machine.scheduler.nowCycles();
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& scheduler = runtime.frameScheduler;
	require(!scheduler.runScheduledToNextLogicalTick(runtime, (edge - 1) / runtime.timing.cpuCyclesPerMillisecond), "partial grant stops before VBlank");
	auto& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0(0x00010001u);
	require(gpu.captureState().pendingCommandCycles == 1, "readback has a one-cycle command deadline");
	require(scheduler.runScheduledToNextLogicalTick(runtime, 1.0 / runtime.timing.cpuCyclesPerMillisecond), "readback and VBlank share a deadline");
	auto& readback = gpu.readDeviceOutput().readbackPort;
	require(readback.claimReadback(gpu.readDeviceOutput().commandBuffer.executedCommandCount), "backend claims the request");
	scheduler.synchronizeBackendService(runtime);
	require(!scheduler.runScheduledToNextLogicalTick(runtime, 1000.0 / runtime.timing.cpuCyclesPerMillisecond), "submitted work remains suspended");
	require(runtime.machine.scheduler.nowCycles() == edge, "submitted backend work consumes no machine time");
	readback.completeReadback(readback.token());
	scheduler.synchronizeBackendService(runtime);
	require(runtime.machine.scheduler.nowCycles() == edge, "completion acknowledgment executes nothing");
	require(scheduler.lastTickSequence == 1, "completion acknowledgment cannot cross another tick");
	require(!scheduler.runScheduledToNextLogicalTick(runtime, 1000.0 / runtime.timing.cpuCyclesPerMillisecond), "next grant stops before another tick");
	require(runtime.machine.scheduler.nowCycles() == edge + 1000, "next grant is independent of the completed fence");
}

void testScheduledBoundedTickMatchesCommonHostRates() {
	constexpr std::array<int, 3> HOST_RATES = {60, 120, 144};
	bmsx::i64 expectedTickSequence = -1;
	bmsx::i64 expectedMachineCycles = -1;
	for (const int rate : HOST_RATES) {
		TickRuntimeFixture fixture;
		bmsx::Runtime& runtime = fixture.runtime;
		bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
		for (int hostFrame = 0; hostFrame < rate; ++hostFrame) {
			bool completed = scheduler.runScheduledToNextLogicalTick(
				runtime,
				1000.0 / static_cast<bmsx::f64>(rate)
			);
			while (completed) {
				completed = scheduler.runScheduledToNextLogicalTick(runtime, 0.0);
			}
		}
		if (expectedTickSequence < 0) {
			expectedTickSequence = scheduler.lastTickSequence;
			expectedMachineCycles = runtime.machine.scheduler.nowCycles();
		} else {
			require(
				scheduler.lastTickSequence == expectedTickSequence,
				"common host rates publish the same logical tick count"
			);
			require(
				runtime.machine.scheduler.nowCycles() == expectedMachineCycles,
				"common host rates consume the same machine time"
			);
		}
	}
	require(expectedTickSequence == 49, "one PAL wall second publishes 49 complete VBlanks");
	require(expectedMachineCycles == bmsx::PSX_CPU_FREQ_HZ, "one wall second advances one CPU second");
}

void testBoundedLogicalTickExtendsExhaustedRetainedGrant() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	runtime.frameLoop.beginFrameState(runtime, 0, 0);
	bmsx::FrameSchedulerStateSnapshot pendingState = scheduler.captureState();
	pendingState.logicalTickRunPending = true;
	pendingState.logicalTickRunTargetSequence = 1;
	scheduler.restoreState(pendingState);

	require(
		scheduler.runToNextLogicalTick(runtime),
		"bounded execution extends an exhausted explicit grant"
	);
	require(scheduler.lastTickSequence == 1, "the retained target completes on the next edge");
	require(
		scheduler.lastTickBudgetGranted == runtime.timing.cycleBudgetPerFrame,
		"the resumed operation grants one current PCRTC period"
	);
	require(
		!scheduler.captureState().logicalTickRunPending,
		"the completed retained target clears its pending state"
	);
}

void testBoundedLogicalTickDoesNotReportResetAsTargetEdge() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);

	require(
		!runtime.frameScheduler.runToNextLogicalTick(runtime),
		"system reset does not report completion of the abandoned target"
	);
	require(runtime.frameScheduler.lastTickSequence == 0, "system reset clears the logical tick sequence");
	require(
		!runtime.frameScheduler.captureState().logicalTickRunPending,
		"system reset abandons the bounded operation"
	);
}

void testLogicalTickPublishesInputAndEntersWaitingCpuInterrupt() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::Memory& memory = runtime.machine.memory;
	fixture.input.keyDown = true;
	const int frameDepth = runtime.machine.cpu.getFrameDepth();
	memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);

	require(
		runtime.frameScheduler.runToNextLogicalTick(runtime),
		"bounded execution reaches the armed input edge"
	);

	require(fixture.input.sampleCount == 1, "the logical tick samples ICU input once");
	require(memory.readMappedU32LE(bmsx::IO_INP_STATUS) == 1u, "the logical tick publishes the ICU sequence");
	const bmsx::u32 keyWordAddress = bmsx::IO_INP_KEYS
		+ (TEST_KEY_USAGE >> 5u) * bmsx::IO_WORD_SIZE;
	require(
		(memory.readMappedU32LE(keyWordAddress) & (1u << (TEST_KEY_USAGE & 31u))) != 0u,
		"the logical tick publishes the raw ICU key word"
	);
	require(
		(memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u,
		"the logical tick raises the VBlank IRQ"
	);
	require(
		runtime.machine.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None,
		"the waiting CPU accepts the VBlank IRQ on the scheduler fence"
	);
	require(
		runtime.machine.cpu.getFrameDepth() == frameDepth + 1,
		"bounded execution returns after IRQ entry and before its first instruction"
	);
}

void testLogicalTickIsBoundedWithoutVblankDeadline() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(
		bmsx::GX_GPU_PCRTC_SMODE1_LOW
	);
	const bmsx::u32 smode1 = runtime.machine.memory.readMappedU32LE(smode1Address);
	runtime.machine.memory.writeMappedU32LE(
		smode1Address,
		smode1 | bmsx::GX_GPU_PCRTC_SMODE1_SINT
	);
	bmsx::runDueRuntimeTimers(runtime);
	const bmsx::i64 cycle = runtime.machine.scheduler.nowCycles();

	require(runtime.timing.cycleBudgetPerFrame == 0, "stopped PCRTC publishes no tick budget");
	require(
		!runtime.frameScheduler.runToNextLogicalTick(runtime),
		"bounded execution reports no logical tick while PCRTC is stopped"
	);
	require(runtime.frameScheduler.lastTickSequence == 0, "stopped PCRTC does not fabricate a tick");
	require(runtime.machine.scheduler.nowCycles() == cycle, "stopped PCRTC does not consume machine cycles");
}

void testNormalHostExecutionKeepsExistingSchedulerContract() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	const bmsx::f64 exactHostGrant = runtime.timing.frameDurationMs
		* runtime.timing.cpuCyclesPerMillisecond;
	const bmsx::i64 wholeHostGrant = static_cast<bmsx::i64>(exactHostGrant);

	runtime.frameScheduler.run(runtime, runtime.timing.frameDurationMs);

	require(runtime.frameScheduler.lastTickSequence == 1, "normal host execution reaches one VBlank");
	require(
		runtime.machine.scheduler.nowCycles() == wholeHostGrant,
		"normal host execution consumes its existing host-derived cycle grant"
	);
	require(
		runtime.frameScheduler.captureState().cycleGrantRemainder
			== exactHostGrant - static_cast<bmsx::f64>(wholeHostGrant),
		"normal host execution retains its existing fractional cycle grant"
	);
}

void testGpuRawExtensionWordCodec() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	for (const bmsx::u32 word : {0x600000ffu, 0u, 0x00010001u}) runtime.machine.gxGpu.writeGp0(word);
	auto state = bmsx::captureRuntimeSaveState(runtime);
	auto& gpu = state.machineState.machine.gxGpu;
	require(!gpu.commandBuffer.commandVramYAddressExtensionWord.empty(), "rectangle is present in the saved command stream");
	gpu.commandBuffer.commandVramYAddressExtensionWord[0] = 0xfedcba98u;
	gpu.commandBuffer.readbackVramYAddressExtensionWord = 0x100u;
	gpu.userIngressContext.readbackVramYAddressExtensionWord = 0x80000000u;
	const auto bytes = bmsx::encodeRuntimeSaveState(state);
	const auto decoded = bmsx::decodeRuntimeSaveState(bytes, bmsx::PSX_MACHINE_SPEC.ramBytes, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	const auto& actual = decoded.machineState.machine.gxGpu;
	require(actual.commandBuffer.commandVramYAddressExtensionWord[0] == 0xfedcba98u
		&& actual.commandBuffer.readbackVramYAddressExtensionWord == 0x100u
		&& actual.userIngressContext.readbackVramYAddressExtensionWord == 0x80000000u,
		"the native codec preserves full raw extension words in command, readback and user ingress state");
}

void testRuntimeCheckpointStorage() {
	TickRuntimeFixture fixture(bmsx::CartridgeSocketMediaPair{{
		bmsx::CartridgeCardMedia{std::nullopt, 12u, true},
		bmsx::CartridgeCardMedia{std::nullopt, 20u, true},
	}});
	auto& runtime = fixture.runtime;
	auto& memory = runtime.machine.memory;
	auto& gpu = runtime.machine.gxGpu;
	const auto anchor = bmsx::captureRuntimeSaveState(runtime);
	const auto anchorBytes = bmsx::encodeRuntimeSaveState(anchor);
	auto storage = bmsx::captureRuntimeSaveState(runtime);
	const auto& machine = storage.machineState.machine;
	const std::array<const bmsx::u8*, 5> regions{
		machine.memory.ram.data(), machine.gxGpu.vramBytes.data(), machine.audio.sampleRam.data(),
		machine.cartridge.slots[0]->ram->data(), machine.cartridge.slots[1]->ram->data(),
	};
	std::vector<bmsx::u8> vram(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	for (bmsx::u32 pass = 1; pass <= 4; ++pass) {
		const bmsx::u32 word = 0xfedcba00u | pass;
		memory.writeU32(bmsx::RAM_BASE + bmsx::PSX_MACHINE_SPEC.ramBytes - 4, word);
		for (bmsx::u32 slot = 0; slot < 2; ++slot) {
			memory.writeMappedU32LE(bmsx::IO_CART_SELECT, 0x80000000u | slot);
			memory.writeMappedU32LE(bmsx::CART_RAM_BASE + machine.cartridge.slots[slot]->ram->size() - 4, word ^ slot);
		}
		memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_ADDRESS, bmsx::APU_SAMPLE_RAM_BYTES - 4);
		memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_CONTROL, bmsx::APU_TRANSFER_MODE_MANUAL_WRITE);
		memory.writeMappedU32LE(bmsx::IO_APU_TRANSFER_DATA, word);
		require(runtime.frameScheduler.runToNextLogicalTick(runtime), "sample transfer reaches its deadline");
		std::fill(vram.begin(), vram.end(), static_cast<bmsx::u8>(pass));
		gpu.replaceVramSnapshotBytes(vram);
		const auto expected = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
		storage = bmsx::captureRuntimeSaveState(runtime, std::move(storage));
		require(machine.memory.ram.data() == regions[0], "main RAM buffer is reused");
		require(machine.gxGpu.vramBytes.data() == regions[1], "VRAM buffer is reused");
		require(machine.audio.sampleRam.data() == regions[2], "sample RAM buffer is reused");
		require(bmsx::readLE32(machine.audio.sampleRam.data() + bmsx::APU_SAMPLE_RAM_BYTES - 4) == word, "APU transfer captured");
		for (size_t slot = 0; slot < 2; ++slot) {
			const auto& ram = *machine.cartridge.slots[slot]->ram;
			require(ram.data() == regions[3 + slot], "both cartridge RAM buffers are reused");
			require(bmsx::readLE32(ram.data() + ram.size() - 4) == (word ^ slot), "mapped cartridge bytes captured");
		}
		require(bmsx::encodeRuntimeSaveState(storage) == expected, "reused state equals independent capture");
		require(bmsx::encodeRuntimeSaveState(anchor) == anchorBytes, "independent snapshot remains intact");
	}
	bool notified = false;
	runtime.onStateRestored = [&](bmsx::RuntimeRestoreOrigin origin) {
		require(origin == bmsx::RuntimeRestoreOrigin::ExternalLoad, "save-state load publishes its actual restore origin");
		notified = true;
	};
	bmsx::applyRuntimeSaveState(runtime, anchor);
	require(notified, "external restore notifies after applying state");
	const auto restored = bmsx::captureRuntimeSaveState(runtime);
	const auto& restoredMachine = restored.machineState.machine;
	const auto& anchorMachine = anchor.machineState.machine;
	require(restoredMachine.memory.ram == anchorMachine.memory.ram, "original main RAM restores intact");
	require(restoredMachine.audio.sampleRam == anchorMachine.audio.sampleRam, "original sample RAM restores intact");
	require(restoredMachine.gxGpu.vramBytes == anchorMachine.gxGpu.vramBytes, "original VRAM restores intact");
	for (size_t slot = 0; slot < 2; ++slot) {
		require(restoredMachine.cartridge.slots[slot]->ram == anchorMachine.cartridge.slots[slot]->ram, "original cartridge RAM restores intact");
	}
	require(restoredMachine.gxGpu.vramPresentationPending, "restore requests host redraw");
}

void testHistoryPressureAndBranch() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& history = runtime.history;
	history.start({2, 2, 0x100000000LL});
	require(!runtime.frameScheduler.runToNextLogicalTick(runtime), "initial checkpoint suspends execution");
	require(runtime.machine.scheduler.nowCycles() == 0, "initial capture barrier holds machine time");
	history.captureCheckpoint();
	require(runtime.frameScheduler.runToNextLogicalTick(runtime), "first recorded boundary");
	const auto firstCycles = runtime.machine.scheduler.nowCycles();
	require(runtime.frameScheduler.runToNextLogicalTick(runtime), "second recorded boundary");
	require(history.checkpointPending, "input pressure requests a checkpoint");
	const auto secondCycles = runtime.machine.scheduler.nowCycles();
	runtime.frameScheduler.run(runtime, 80.0);
	require(runtime.machine.scheduler.nowCycles() == secondCycles, "pressure cannot lose input during a host catch-up");
	require(history.inputJournal.endSequence == 2, "no extra input while capture is pending");
	history.captureCheckpoint();
	require(runtime.frameScheduler.runToNextLogicalTick(runtime), "capture releases execution");
	require(history.checkpointCount() == 1 && history.earliestCycles() == secondCycles, "expired input evicts only obsolete checkpoints");
	history.beginSeek(firstCycles);
	require(history.targetCycles == secondCycles && history.mode == bmsx::HistoryMode::Reviewing, "seek respects retained range");
	runtime.frameScheduler.run(runtime, 80.0);
	require(runtime.machine.scheduler.nowCycles() == secondCycles, "review blocks ordinary host execution");
	require(history.advanceSeek(100) == bmsx::HistorySeekResult::Complete, "checkpoint is an exact seek endpoint");
	history.resumeRecording();
	require(history.checkpointPending && history.inputJournal.endSequence == 2, "live takeover branches before new input");
	history.captureCheckpoint();
	runtime.rebootSystem();
	require(history.mode == bmsx::HistoryMode::Disabled && history.checkpointCount() == 0 && history.inputJournal.storageBytes() == 0, "reset ends history");
}

void testHistoryReviewEnd() {
	for (const bool replaying : {false, true}) for (int operation = 0; operation < 3; ++operation) {
		TickRuntimeFixture fixture;
		auto& runtime = fixture.runtime;
		auto& history = runtime.history;
		int ended = 0, resumed = 0;
		history.onWillResumeRecording = [&](bool) { ++resumed; };
		history.start({2, 8, 0x100000000LL});
		history.captureCheckpoint();
		for (int tick = 0; tick < 3; ++tick) runtime.frameScheduler.runToNextLogicalTick(runtime);
		const auto replacement = bmsx::captureRuntimeSaveState(runtime);
		history.beginSeek(replaying ? history.latestCycles() : history.earliestCycles());
		const auto reviewedMode = replaying ? bmsx::HistoryMode::Replaying : bmsx::HistoryMode::Reviewing;
		require(history.mode == reviewedMode, "stop fixture is reviewing or replaying");
		const auto cycles = runtime.machine.scheduler.nowCycles();
		history.onWillEndReview = [&]() {
			++ended;
			require(history.mode == reviewedMode && runtime.machine.scheduler.nowCycles() == cycles,
				"review ends before its position is changed");
			require(history.checkpointCount() == 1 && history.inputJournal.endSequence == 3,
				"reviewers reconcile before retained history is discarded");
		};
		if (operation == 0) history.stop();
		else if (operation == 1) runtime.rebootSystem();
		else bmsx::applyRuntimeSaveState(runtime, replacement);
		require(ended == 1 && resumed == 0, "discard ends review once without recording admission");
		require(history.mode == bmsx::HistoryMode::Disabled, "discard disables history");
		history.stop();
		history.start({2, 8, 0x100000000LL});
		history.captureCheckpoint();
		history.stop();
		require(ended == 1, "disabled and ordinary recording stops do not end a review");
	}
}

void testHistoryRejoin() {
	struct Case { size_t inputCapacity; bmsx::i64 intervalCycles; bool pending; };
	for (const auto test : {Case{8, 0x100000000LL, false}, Case{2, 0x100000000LL, true}, Case{8, 1, true}}) {
		TickRuntimeFixture fixture;
		auto& runtime = fixture.runtime;
		auto& history = runtime.history;
		history.start({2, test.inputCapacity, test.intervalCycles});
		history.captureCheckpoint();
		runtime.frameScheduler.runToNextLogicalTick(runtime);
		if (!history.checkpointPending) runtime.frameScheduler.runToNextLogicalTick(runtime);
		const auto end = history.latestCycles();
		const auto sequence = history.inputJournal.endSequence;
		history.beginSeek(end);
		for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 1000; ++step) {
			require(history.advanceSeek(16384) != bmsx::HistorySeekResult::Stopped, "rejoin replay advances");
		}
		require(history.mode == bmsx::HistoryMode::Reviewing, "rejoin reaches recorded end");
		bool resumed = false;
		bool reviewEnded = false;
		history.onWillEndReview = [&]() {
			require(history.mode == bmsx::HistoryMode::Reviewing, "review end precedes recording admission");
			reviewEnded = true;
		};
		history.onWillResumeRecording = [&](bool branched) {
			require(reviewEnded, "bookmarks reconcile before recording admission");
			require(!branched, "returning to the recorded end does not begin a new timeline");
			resumed = true;
		};
		history.resumeRecording();
		require(resumed, "rejoin publishes recording admission");
		require(history.checkpointPending == test.pending, "rejoin preserves interval and input-pressure capture requests");
		require(history.checkpointCount() == 1, "looking at history must not evict a checkpoint");
		require(history.earliestCycles() == 0 && history.latestCycles() == end, "rejoin preserves retained range");
		require(history.inputJournal.endSequence == sequence, "rejoin preserves recorded input");
	}
}

void testInputJournalRawWordsAndWrap() {
	bmsx::InputJournal journal;
	journal.reset(3);
	bmsx::InputControllerSnapshot snapshot;
	std::array<bmsx::u32, bmsx::INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT> expected;
	for (size_t i = 0; i < expected.size(); ++i) expected[i] = 0xfedcba98u + static_cast<bmsx::u32>(i) * 31u;
	bmsx::loadInputControllerSnapshotWords(snapshot, expected, 0);
	journal.recordSample(snapshot, bmsx::InputControllerSampleContext::Normal);
	journal.recordLine(0x100000001LL, false);
	journal.recordLine(0x100000002LL, true);
	journal.recordSample(snapshot, bmsx::InputControllerSampleContext::Supervisor);
	journal.recordLine(0x100000003LL, true);
	journal.recordLine(0x100000004LL, false);
	require(journal.firstSequence == 1 && journal.endSequence == 4, "input ring wraps");
	require(journal.flagsAt(1) == 4 && journal.flagsAt(2) == 7 && journal.flagsAt(3) == 0, "unarmed polls and contexts retain their exact flags");
	require(journal.cycleAt(3) == 0x100000004LL && journal.endAt(0x100000002LL) == 2, "journal retains full machine cycles");
	require(journal.storageBytes() == 3 * (8 + 4 * (1 + bmsx::INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT)), "bounded raw journal storage");
	journal.replaySequence = 1;
	require(journal.replayLine(), "unarmed supervisor edge replays");
	bmsx::InputControllerSnapshot restored;
	journal.replaySample(restored);
	require(journal.replayLine(), "supervisor-context line replays");
	std::array<bmsx::u32, bmsx::INPUT_CONTROLLER_SNAPSHOT_WORD_COUNT> actual;
	bmsx::storeInputControllerSnapshotWords(restored, actual, 0);
	require(actual == expected, "all snapshot words replay without conversion");
	journal.branch();
	require(journal.endSequence == 3, "input branch truncates future");
	journal.recordLine(0x100000005LL, true);
	require(journal.replayLine(), "new branch replaces the old future");
}

void testHistoryObservationProvenance() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& history = runtime.history;
	require(history.recordingCheckpoint() == -1 && !history.canSeekFrom(-1, 0), "disabled history has no observation anchor");
	history.start({4, 16, 0x100000000LL});
	require(history.recordingCheckpoint() == -1, "the initial capture has not completed");
	history.captureCheckpoint();
	const auto original = history.recordingCheckpoint();
	for (int tick = 0; tick < 4; ++tick) require(runtime.frameScheduler.runToNextLogicalTick(runtime), "recorded provenance boundary");
	const auto first = history.inputJournal.cycleAt(0), second = history.inputJournal.cycleAt(1), third = history.inputJournal.cycleAt(2);
	const auto end = history.latestCycles();
	require(history.canSeekFrom(original, first + 1), "recorded event cycles have provenance");
	require(!history.canSeekFrom(original, end + 1), "an unfinished live frame is outside physical history");
	history.beginSeek(end);
	require(history.recordingCheckpoint() == -1, "replay cannot originate a live observation");
	for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 1000; ++step) history.advanceSeek(16384);
	require(history.mode == bmsx::HistoryMode::Reviewing && history.canSeekFrom(original, end), "review retains evidence reachability");
	history.resumeRecording();
	require(history.recordingCheckpoint() == original && history.canSeekFrom(original, end), "rejoin preserves checkpoint identity and continuation");

	history.beginSeek(second);
	for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 1000; ++step) history.advanceSeek(16384);
	require(history.mode == bmsx::HistoryMode::Reviewing, "first branch point reached");
	history.resumeRecording();
	history.captureCheckpoint();
	const auto branch = history.recordingCheckpoint();
	require(branch > original, "a branch has a new checkpoint identity");
	require(history.canSeekFrom(original, second - 1), "the shared past remains reachable");
	require(!history.canSeekFrom(original, second), "an admission at the branch cycle belongs to the discarded future");
	for (int tick = 0; tick < 2; ++tick) runtime.frameScheduler.runToNextLogicalTick(runtime);
	require(history.latestCycles() == end, "new branch reaches overlapping cycles");
	require(!history.canSeekFrom(original, second + 1) && history.canSeekFrom(branch, second + 1), "overlapping cycles cannot revive discarded evidence");
	history.beginSeek(third);
	for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 1000; ++step) history.advanceSeek(16384);
	require(history.mode == bmsx::HistoryMode::Reviewing, "later branch point reached");
	history.resumeRecording();
	history.captureCheckpoint();
	const auto laterBranch = history.recordingCheckpoint();
	require(!history.canSeekFrom(original, second), "a later branch cannot reopen an earlier cutoff");
	require(history.canSeekFrom(branch, third - 1) && !history.canSeekFrom(branch, third), "the second branch clips its own continuation");

	history.beginSeek(first);
	for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 1000; ++step) history.advanceSeek(16384);
	require(history.mode == bmsx::HistoryMode::Reviewing, "earlier branch point reached");
	history.resumeRecording();
	history.captureCheckpoint();
	require(history.recordingCheckpoint() > laterBranch, "discarded checkpoint storage gets a fresh identity");
	for (int tick = 0; tick < 3; ++tick) runtime.frameScheduler.runToNextLogicalTick(runtime);
	require(history.canSeekFrom(original, first - 1) && !history.canSeekFrom(original, first), "earlier branch clips the surviving prefix");
	require(!history.canSeekFrom(branch, second + 1) && !history.canSeekFrom(laterBranch, third + 1), "discarded checkpoint storage is not a retained anchor");
	const auto beforeReset = history.recordingCheckpoint();
	runtime.rebootSystem();
	require(history.recordingCheckpoint() == -1, "reset has no observation anchor");
	history.start({4, 16, 0x100000000LL});
	history.captureCheckpoint();
	require(history.recordingCheckpoint() > beforeReset, "checkpoint identities never restart with machine cycles");
	require(!history.canSeekFrom(original, 0) && history.canSeekFrom(history.recordingCheckpoint(), 0), "reset cycles cannot alias old provenance");
}

void testHistoryObservationEviction() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& history = runtime.history;
	history.start({2, 4, 0x100000000LL});
	history.captureCheckpoint();
	const auto initial = history.recordingCheckpoint();
	runtime.frameScheduler.runToNextLogicalTick(runtime);
	const auto first = history.latestCycles();
	history.captureCheckpoint();
	const auto retained = history.recordingCheckpoint();
	runtime.frameScheduler.runToNextLogicalTick(runtime);
	history.captureCheckpoint();
	const auto newest = history.recordingCheckpoint();
	require(!history.canSeekFrom(initial, first) && history.canSeekFrom(retained, first), "reused ring slots have new identities");
	for (int tick = 0; tick < 4; ++tick) runtime.frameScheduler.runToNextLogicalTick(runtime);
	require(!history.canSeekFrom(retained, first), "input pressure removes the old anchor");
	require(history.canSeekFrom(newest, history.latestCycles()), "the newest anchor still has retained input");
	history.stop();
	require(!history.canSeekFrom(newest, history.latestCycles()), "stopped history has no retained anchors");
}

void testHistoryUnarmedSupervisorEdge() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& history = runtime.history;
	history.start({2, 8, 0x100000000LL});
	history.captureCheckpoint();
	// Compare the NMI request edge; the minimal ROM has no monitor firmware
	// to restart the quiesced PCRTC after this point.
	for (int tick = 0; tick < 2; ++tick) {
		fixture.input.supervisorHigh = tick == 1;
		require(runtime.frameScheduler.runToNextLogicalTick(runtime), "recorded input boundary");
		runtime.machine.gxGpu.retirePresentedCommands();
	}
	require(fixture.input.sampleCount == 0 && history.inputJournal.flagsAt(1) == 4, "unarmed ICU records the supervisor edge");
	const auto expected = bmsx::captureRuntimeSaveState(runtime);
	fixture.input.rejectLiveInput = true;
	history.beginSeek(expected.machineState.schedulerNowCycles);
	for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 1000; ++step) {
		require(history.advanceSeek(16384) != bmsx::HistorySeekResult::Stopped, "supervisor replay advances");
		runtime.machine.gxGpu.retirePresentedCommands();
	}
	require(history.mode == bmsx::HistoryMode::Reviewing, "supervisor replay reaches the recorded request edge");
	auto actual = bmsx::captureRuntimeSaveState(runtime);
	require(actual.machineState.schedulerNowCycles == expected.machineState.schedulerNowCycles, "request edge has the same machine time");
	require(actual.machineState.frameScheduler.lastTickSequence == expected.machineState.frameScheduler.lastTickSequence, "request edge has the same PCRTC tick");
	actual.machineState.frameScheduler = expected.machineState.frameScheduler;
	actual.machineState.frameLoop = expected.machineState.frameLoop;
	require(bmsx::encodeRuntimeSaveState(actual) == bmsx::encodeRuntimeSaveState(expected), "unarmed supervisor edge reproduces complete guest state");
}

void testPacedHistoryPlayback() {
	for (const int rate : {50, 60, 144}) {
		TickRuntimeFixture fixture;
		auto& runtime = fixture.runtime;
		auto& history = runtime.history;
		fixture.input.keyDown = true;
		runtime.machine.memory.writeIoU32(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
		history.start({2, 64, 0x100000000LL});
		history.captureCheckpoint();
		for (int tick = 0; tick < 20; ++tick) runtime.frameScheduler.runToNextLogicalTick(runtime);
		const auto expected = bmsx::captureRuntimeSaveState(runtime);
		const auto end = history.latestCycles();
		const auto sequence = history.inputJournal.endSequence;
		const int sampleCount = fixture.input.sampleCount;
		fixture.input.keyDown = false;
		fixture.input.rejectLiveInput = true;
		int restores = 0;
		runtime.onStateRestored = [&](bmsx::RuntimeRestoreOrigin origin) {
			require(origin == bmsx::RuntimeRestoreOrigin::HistorySeek, "history publishes its actual restore origin");
			++restores;
		};
		history.beginSeek(history.earliestCycles());
		history.beginPlayback();
		history.advancePlayback(5.123);
		const auto pausedAt = runtime.machine.scheduler.nowCycles();
		require(pausedAt > 0 && pausedAt < runtime.timing.cycleBudgetPerFrame, "playback uses a fractional host-time grant");
		history.cancelSeek();
		history.advancePlayback(600000);
		require(runtime.machine.scheduler.nowCycles() == pausedAt, "pause holds between input boundaries");
		history.beginPlayback();
		history.advancePlayback(0);
		require(runtime.machine.scheduler.nowCycles() == pausedAt, "resume does not charge paused time or old grants");
		int frames = 0;
		for (; history.mode == bmsx::HistoryMode::Replaying && frames < 200; ++frames) history.advancePlayback(1000.0 / rate);
		require(history.mode == bmsx::HistoryMode::Reviewing && runtime.machine.scheduler.nowCycles() == end, "playback stops at recorded end");
		const auto duration = (end - pausedAt) / runtime.timing.cpuCyclesPerMillisecond;
		require(std::abs(frames * 1000.0 / rate - duration) <= 1000.0 / rate, "playback obeys normal 50/60/144-Hz host pacing");
		require(restores == 1 && history.checkpointCount() == 1, "Play/Pause continues the current machine, without restore/capture");
		require(history.latestCycles() == end && history.inputJournal.endSequence == sequence && history.inputJournal.replaySequence == sequence, "playback preserves future input");
		require(fixture.input.sampleCount == sampleCount, "playback does not consume live input");
		auto actual = bmsx::captureRuntimeSaveState(runtime);
		actual.machineState.frameScheduler = expected.machineState.frameScheduler;
		actual.machineState.frameLoop = expected.machineState.frameLoop;
		require(actual.machineState.machine.gxGpu.vramPresentationPending, "restore requests a host redraw");
		actual.machineState.machine.gxGpu.vramPresentationPending = expected.machineState.machine.gxGpu.vramPresentationPending;
		require(bmsx::encodeRuntimeSaveState(actual) == bmsx::encodeRuntimeSaveState(expected), "all guest state is identical apart from host scheduling/delivery metadata");
	}
}

void testCancelledHistoryTakeover() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& history = runtime.history;
	history.start({2, 8, 0x100000000LL});
	history.captureCheckpoint();
	for (int tick = 0; tick < 3; ++tick) runtime.frameScheduler.runToNextLogicalTick(runtime);
	const auto end = history.latestCycles();
	history.beginSeek(end);
	require(history.advanceSeek(256) == bmsx::HistorySeekResult::Progressed, "partial seek advances");
	require(runtime.frameScheduler.captureState().logicalTickRunPending, "partial replay has a retained scheduler target");
	history.cancelSeek();
	const auto cancelledCycles = runtime.machine.scheduler.nowCycles();
	runtime.frameScheduler.run(runtime, 80.0);
	require(runtime.machine.scheduler.nowCycles() == cancelledCycles, "cancellation suspends machine time");
	require(history.latestCycles() == end && history.inputJournal.endSequence == 3, "cancellation retains future");
	bool resumed = false;
	history.onWillResumeRecording = [&](bool branched) {
		require(branched, "taking over a partial replay begins a new timeline");
		require(history.mode == bmsx::HistoryMode::Reviewing && runtime.machine.scheduler.nowCycles() == cancelledCycles,
			"bookmarks reconcile the suspended review position");
		require(history.inputJournal.endSequence == 3, "bookmarks reconcile before future truncation");
		resumed = true;
	};
	history.resumeRecording();
	require(resumed, "history publishes recording admission");
	require(history.inputJournal.endSequence == 0 && !runtime.frameScheduler.captureState().logicalTickRunPending, "takeover branches and releases the replay scheduler target");
	history.captureCheckpoint();
	runtime.frameScheduler.run(runtime, runtime.timing.frameDurationMs * 2);
	const auto before = runtime.frameScheduler.lastTickSequence;
	require(runtime.frameScheduler.runToNextLogicalTick(runtime) && runtime.frameScheduler.lastTickSequence == before + 1, "live scheduling no longer targets a discarded replay tick");
}

void testHistoryAwaitingBackendCompletion() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	auto& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(static_cast<bmsx::u32>(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST) << 24u);
	gpu.writeGp0(0);
	gpu.writeGp0((1u << 16u) | 1u);
	auto& history = runtime.history;
	history.start({2, 8, 0x100000000LL});
	history.captureCheckpoint();
	require(!runtime.frameScheduler.runToNextLogicalTick(runtime), "recording suspends on readback");
	const auto& output = gpu.readDeviceOutput();
	require(output.readbackPort.claimReadback(output.commandBuffer.executedCommandCount), "recording backend claims the request");
	output.readbackPort.completeReadback(output.readbackPort.token());
	require(runtime.frameScheduler.runToNextLogicalTick(runtime), "recording reaches VBlank after readback");
	history.beginSeek(history.latestCycles());
	require(history.advanceSeek(16384) == bmsx::HistorySeekResult::BackendPending, "replay exposes backend work");
	require(output.readbackPort.claimReadback(output.commandBuffer.executedCommandCount), "replay backend claims the request");
	const auto cycles = runtime.machine.scheduler.nowCycles();
	const auto grant = runtime.frameLoop.frameState.cycleBudgetGranted;
	require(!gpu.backendServicePending(), "readback has already been submitted");
	require(history.advanceSeek(16384) == bmsx::HistorySeekResult::BackendPending, "submitted readback is a wait, not a stopped replay");
	require(runtime.machine.scheduler.nowCycles() == cycles && runtime.frameLoop.frameState.cycleBudgetGranted == grant, "backend wait consumes neither cycles nor new grants");
	output.readbackPort.completeReadback(output.readbackPort.token());
	for (int step = 0; history.mode == bmsx::HistoryMode::Replaying && step < 100; ++step) {
		require(history.advanceSeek(16384) != bmsx::HistorySeekResult::Stopped, "completed readback releases replay");
	}
	require(history.mode == bmsx::HistoryMode::Reviewing, "replay completes after backend service");
	history.beginSeek(history.earliestCycles());
	history.beginPlayback();
	history.advancePlayback(runtime.timing.frameDurationMs);
	require(output.readbackPort.claimReadback(output.commandBuffer.executedCommandCount), "paced replay exposes the same backend request");
	const auto playbackBlocked = runtime.machine.scheduler.nowCycles();
	const auto playbackGrant = runtime.frameLoop.frameState.cycleBudgetGranted;
	history.advancePlayback(600000);
	require(runtime.machine.scheduler.nowCycles() == playbackBlocked, "pending playback fence consumes no cycles");
	output.readbackPort.completeReadback(output.readbackPort.token());
	history.advancePlayback(600000);
	require(runtime.frameScheduler.lastTickBudgetGranted == playbackGrant && runtime.machine.scheduler.nowCycles() - playbackBlocked <= playbackGrant, "completion consumes the already accepted grant, not backend latency");
	for (int step = 0; step < 10; ++step) history.advancePlayback(runtime.timing.frameDurationMs);
	require(history.mode == bmsx::HistoryMode::Reviewing, "paced replay completes after backend service");
}

} // namespace

void testRuntimeResetNotification() {
	TickRuntimeFixture fixture;
	auto& runtime = fixture.runtime;
	int resets = 0;
	runtime.onStateReset = [&]() {
		++resets;
		require(runtime.machine.cpu.getFrameDepth() == 1u, "notification follows replacement of execution state");
	};
	runtime.rebootSystem();
	require(resets == 1, "reboot notifies once");
	runtime.boot();
	require(resets == 2, "boot notifies once");
}

int main() {
	testGpuRawExtensionWordCodec();
	testSupervisorGpuServiceAtDeviceBoundaries();
	testSupervisorServiceBanksUnreadReadback();
	testDmaSharedBusStopsCpu();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	testWarmedGeneratedDmaSharedBus();
#endif
	testDeviceSettlementRetainsCpuStop();
	testDeviceSettlementBackendFence();
	testBusyCpuBudgetAtVblank();
	testRuntimeResetNotification();
	testBoundedLogicalTickRetainsCycleCarry();
	testBoundedLogicalTickResumesBackendFenceWithoutAnotherGrant();
	testRawCycleGrantsStayExactAcrossSplitAdmissionAndPacedCarry();
	testRawCycleGrantExceedsPacedLimitsAndResumesRetainedTicks();
	testRawCycleAdmissionRetainsSplitGrantsDuringSubmittedReadback();
	testRawCycleAdmissionDoesNotQueueWhileHistoryHoldsExecution();
	testScheduledBoundedTickRetainsPartialMachineProgress();
	testScheduledBoundedTickExposesEveryCatchUpBoundary();
	testScheduledBoundedTickResumesBackendFenceWithAcceptedHostGrant();
	testBackendCompletionAtVblankDoesNotExecuteAnotherTick();
	testScheduledBoundedTickMatchesCommonHostRates();
	testBoundedLogicalTickExtendsExhaustedRetainedGrant();
	testBoundedLogicalTickDoesNotReportResetAsTargetEdge();
	testLogicalTickPublishesInputAndEntersWaitingCpuInterrupt();
	testLogicalTickIsBoundedWithoutVblankDeadline();
	testNormalHostExecutionKeepsExistingSchedulerContract();
	testRuntimeCheckpointStorage();
	testHistoryPressureAndBranch();
	testHistoryReviewEnd();
	testHistoryRejoin();
	testHistoryObservationProvenance();
	testHistoryObservationEviction();
	testInputJournalRawWordsAndWrap();
	testHistoryUnarmedSupervisorEdge();
	testPacedHistoryPlayback();
	testCancelledHistoryTakeover();
	testHistoryAwaitingBackendCompletion();
	return 0;
}
