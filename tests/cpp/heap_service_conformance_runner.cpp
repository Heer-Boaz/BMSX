#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "machine/runtime/runtime.h"
#include "machine/runtime/history/ram_history.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/heap_service.h"
#include "spec/bmsx/model.h"

namespace {
using namespace bmsx;

class ProbeInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

std::vector<u8> loadFile(const char* path) {
	std::ifstream file(path, std::ios::binary);
	if (!file) throw std::runtime_error(std::string("Cannot open ") + path);
	return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}
}

int main(int argc, char** argv) {
	try {
		if (argc < 4 || argc > 6) throw std::runtime_error("Expected system ROM, trace, cross-core checkpoint, and optional cartridge ROMs");
		const auto rom = loadFile(argv[1]);
		const auto cart = argc >= 5 ? loadFile(argv[4]) : std::vector<u8>{};
		const auto secondCart = argc == 6 ? loadFile(argv[5]) : std::vector<u8>{};
		CartridgeSocketMediaPair cartridges{};
		if (argc >= 5) cartridges[0] = CartridgeCardMedia{std::span<const u8>(cart), {}, false};
		if (argc == 6) cartridges[1] = CartridgeCardMedia{std::span<const u8>(secondCart), {}, false};
		std::ifstream trace(argv[2]);
		if (!trace) throw std::runtime_error("Cannot open trace");
		ProbeInput input;
		Runtime runtime({rom, cartridges, PSX_MACHINE_SPEC}, input);
		runtime.boot();
		auto& cpu = runtime.machine.cpu;
		auto& memory = runtime.machine.memory;
		auto& scheduler = runtime.machine.scheduler;
		const auto occupied = cpu.heapAllocator().occupiedBytes();
		RuntimeSaveState saved;
		RuntimeCheckpointState historyCheckpoint;
		RamHistory ramHistory;
		RamHistory::PageMap historyBaseline, historyPartial, historyEnd;
		for (char op; trace >> op;) {
			switch (op) {
				case 'B': {
					u32 function, count, args[3];
					trace >> function >> count;
					if (count > 3) throw std::runtime_error("Unexpected fixture arity");
					for (u32 i = 0; i < count; ++i) trace >> args[i];
					std::cout << cpu.beginHeapService(function, {args, count}) << '\n';
					break;
				}
				case 'G': {
					int cycles;
					trace >> cycles;
					if (scheduler.runCpuSlice(0, cycles, 0u, CpuRunKind::Scheduled) != RunResult::Yielded)
						throw std::runtime_error("Heap service did not yield to its caller");
					if (cpu.heapAllocator().occupiedBytes() != occupied)
						throw std::runtime_error("Ordinary heap supplied service frames or closures");
					std::cout << cycles - cpu.instructionBudgetRemaining << ' ' << cpu.heapServiceActive()
						<< ' ' << cpu.heapServiceResult() << '\n';
					break;
				}
				case 'E': {
					int cycles;
					trace >> cycles;
					const auto result = scheduler.runCpuSlice(0, cycles, 0u, CpuRunKind::Scheduled);
					const auto stage = memory.readRamRecordWord(cpu.heapAllocator().managementOffset() + HEAP_SERVICE_EXEC_STAGE_OFFSET);
					std::cout << static_cast<int>(result) << ' ' << cycles - cpu.instructionBudgetRemaining << ' '
						<< cpu.heapServiceActive() << ' ' << stage << ' ' << memory.ramBusEnd()
						<< ' ' << static_cast<int>(cpu.activeCartridgeSlot()) << '\n';
					break;
				}
				case 'J': {
					int cycles, mode;
					trace >> cycles >> mode;
					const auto result = scheduler.runCpuSlice(0, cycles, 0u, mode == 0 ? CpuRunKind::Direct : CpuRunKind::Scheduled);
					const auto stage = memory.readRamRecordWord(cpu.heapAllocator().managementOffset()
						+ HEAP_SERVICE_NEWT_OFFSET + static_cast<u32>(HeapServiceNewtField::Stage));
					std::cout << static_cast<int>(result) << ' ' << cycles - cpu.instructionBudgetRemaining << ' '
						<< cpu.heapServiceActive() << ' ' << stage << ' ' << cpu.heapAllocator().occupiedBytes()
						<< ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'L': {
					int cycles;
					trace >> cycles;
					const auto result = scheduler.runCpuSlice(0, cycles, 0u, CpuRunKind::Scheduled);
					const auto stage = memory.readRamRecordWord(cpu.heapAllocator().managementOffset()
						+ HEAP_SERVICE_GC_OFFSET + static_cast<u32>(HeapServiceGcField::Stage));
					std::cout << static_cast<int>(result) << ' ' << cycles - cpu.instructionBudgetRemaining << ' '
						<< cpu.heapServiceActive() << ' ' << stage << ' ' << cpu.gcHeap().fullEpochs()
						<< ' ' << static_cast<int>(cpu.gcHeap().phase()) << ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'g': {
					int cycles;
					trace >> cycles;
					const u32 epochs = cpu.gcHeap().fullEpochs();
					const u32 actionOffset = cpu.heapAllocator().managementOffset() + HEAP_SERVICE_OBJECT_SWEEP_OFFSET
						+ static_cast<u32>(HeapServiceObjectSweepField::Action);
					i64 spent = 0;
					u32 actions = 0;
					for (int grant = 0; grant < 4096 && cpu.gcHeap().fullEpochs() == epochs; ++grant) {
						scheduler.runCpuSlice(0, cycles, 0u, CpuRunKind::Scheduled);
						spent += cycles - cpu.instructionBudgetRemaining;
						if (cpu.gcHeap().sweepStage() == HeapServiceGcStage::FullObjectSweep) {
							const u32 action = memory.readRamRecordWord(actionOffset);
							if (action != 0u) actions |= 1u << action;
						}
					}
					if (cpu.gcHeap().fullEpochs() == epochs || cpu.heapServiceActive())
						throw std::runtime_error("Timed collection did not complete its epoch");
					std::cout << spent << ' ' << cpu.gcHeap().fullEpochs() << ' ' << actions << '\n';
					break;
				}
				case 'w': {
					u32 words;
					trace >> words;
					std::cout << cpu.gcHeap().stepFullCollection(cpu.gcHeap().fullEpochs(), words, 0u, 0u) << '\n';
					break;
				}
				case 'b': {
					std::string seed;
					trace >> seed;
					std::cout << cpu.stringPool().intern(seed) << '\n';
					break;
				}
				case 'f': {
					std::string name;
					trace >> name;
					const auto key = cpu.stringPool().intern(name);
					const auto value = cpu.getGlobalByKey(key);
					cpu.setGlobalByKey(key, valueNil());
					std::cout << static_cast<u32>(valueTag(value)) << ' ' << valuePayload(value) << '\n';
					break;
				}
				case 'D': {
					int cycles;
					trace >> cycles;
					const auto before = scheduler.nowCycles();
					const auto result = runtime.cpuExecution.runSuspendedUntilDepth(runtime, 0, cycles);
					const auto stage = memory.readRamRecordWord(cpu.heapAllocator().managementOffset()
						+ HEAP_SERVICE_NEWT_OFFSET + static_cast<u32>(HeapServiceNewtField::Stage));
					std::cout << static_cast<int>(result) << ' ' << scheduler.nowCycles() - before
						<< ' ' << cpu.heapServiceActive() << ' ' << stage << ' '
						<< cpu.heapAllocator().occupiedBytes() << ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'K': {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_NATIVE_GATE_PROFILE)
					cpu.prepareSystemNativeCode();
					const auto& allocation = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::AllocateTable)];
					const auto before = allocation;
					const auto result = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
					const auto stage = memory.readRamRecordWord(cpu.heapAllocator().managementOffset()
						+ HEAP_SERVICE_NEWT_OFFSET + static_cast<u32>(HeapServiceNewtField::Stage));
					if (allocation.entries != before.entries + 1 || allocation.returns != before.returns + 1
						|| allocation.resumes != before.resumes || allocation.exceptions != before.exceptions)
						throw std::runtime_error("The generated AllocateTable exit did not hand off exactly once");
					if (result != RunResult::Yielded || !cpu.heapServiceActive()
						|| stage != static_cast<u32>(HeapServiceNewtStage::Scheduled)
						|| cpu.readFramePc(cpu.getFrameDepth() - 1) != cpu.readCurrentInstructionPc())
						throw std::runtime_error("The generated NEWT did not suspend at its own instruction");
					std::cout << allocation.entries - before.entries << '\n';
#else
					throw std::runtime_error("Generated NEWT proof requires BMSX_NATIVE_GATE_PROFILE and native blocks");
#endif
					break;
				}
				case 'a':
				case 'd': {
					auto& frames = runtime.frameScheduler;
					const auto before = frames.lastTickSequence;
					const int result = op == 'a' ? static_cast<int>(frames.advanceLogicalTick(runtime, 0))
						: static_cast<int>(frames.stepInstruction(runtime, 1));
					const u32 management = cpu.heapAllocator().managementOffset();
					std::cout << result << ' ' << scheduler.nowCycles() << ' ' << (frames.lastTickSequence != before)
						<< ' ' << cpu.allocationParked() << ' ' << cpu.allocationReady() << ' ' << cpu.heapServiceActive()
						<< ' ' << static_cast<u32>(cpu.gcHeap().sweepStage())
						<< ' ' << memory.readRamRecordWord(management + HEAP_SERVICE_NEWT_OFFSET)
						<< ' ' << memory.readRamRecordWord(management + HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET)
						<< ' ' << cpu.heapAllocator().occupiedBytes() << ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'v': {
					int cycles;
					trace >> cycles;
					advanceRuntimeTime(runtime, cycles);
					std::cout << scheduler.nowCycles() << '\n';
					break;
				}
				case 'A': {
					u32 bytes;
					trace >> bytes;
					std::cout << cpu.heapAllocator().allocate(bytes, true) << '\n';
					break;
				}
				case 'V': {
					u32 address;
					trace >> address;
					cpu.heapAllocator().free(address);
					break;
				}
				case 'C': {
					const auto values = runtime.readCompletionValues();
					std::cout << (values.size() == 0 ? 0 : asInteger(values.get(0))) << '\n';
					break;
				}
				case 'Y': {
					int array, hash;
					trace >> array >> hash;
					std::cout << cpu.createTable(array, hash).address() << '\n';
					break;
				}
				case 'z': {
					u32 table;
					trace >> table;
					std::cout << cpu.gcHeap().step(valueTable(table), valueNil(), valueNil(), 0u, false, 1) << '\n';
					break;
				}
				case 'y': {
					u32 string;
					trace >> string;
					std::cout << cpu.gcHeap().step(valueString(string), valueNil(), valueNil(), 0u, false, 1) << '\n';
					break;
				}
				case 'Z': std::cout << cpu.readCauseWord() << ' ' << cpu.readLuaFaultReasonWord() << ' ' << cpu.readEpcWord() << '\n'; break;
				case 'F': std::cout << cpu.captureRuntimeState().hardHalted << '\n'; break;
				case 'T': {
					runtime.frameLoop.beginFrameState(runtime, 1000000, 0);
					const auto before = scheduler.nowCycles();
					if (runtime.cpuExecution.runInstruction(runtime, runtime.frameLoop.frameState) != InstructionStepResult::Executed
						|| !cpu.heapServiceActive())
						throw std::runtime_error("Heap service did not execute a scheduled instruction");
					std::cout << scheduler.nowCycles() - before << ' '
						<< runtime.frameLoop.frameState.activeCpuUsedCycles << '\n';
					break;
				}
				case 'W': {
					u32 address, word;
					trace >> address >> word;
					memory.writeRamRecordWord(address, word);
					break;
				}
				case 'O': {
					u32 address, word;
					trace >> address >> word;
					memory.writeMappedWord(address, word);
					break;
				}
				case 'H': {
					u32 first, end, hash = 0x811c9dc5u;
					trace >> first >> end;
					const auto* ram = memory.ramData();
					for (u32 i = first; i < end; ++i) hash = (hash ^ ram[i]) * 0x01000193u;
					std::cout << hash << '\n';
					break;
				}
				case 'M': {
					u32 address;
					trace >> address;
					const u32 sequence = memory.readBusFaultSequence();
					const u32 value = memory.readMappedU32LE(address);
					std::cout << value << ' ' << (memory.readBusFaultSequence() != sequence) << '\n';
					break;
				}
				case 'P': {
					const auto depth = cpu.getFrameDepth();
					std::cout << depth << ' ' << cpu.readFramePc(depth - 1) << '\n';
					break;
				}
				case 'N': cpu.requestNonMaskableInterrupt(); break;
				case 'I': std::cout << cpu.enterPendingInterrupt() << '\n'; break;
				case 'R': {
					const auto before = scheduler.nowCycles();
					try {
						runtime.rebootSystem();
					} catch (const std::runtime_error& error) {
						if (std::string_view(error.what()) != "Heap service must retire before system boot.") throw;
						if (scheduler.nowCycles() != before || !cpu.heapServiceActive())
							throw std::runtime_error("Refused reset changed the suspended service");
						std::cout << "reset deferred\n";
						break;
					}
					throw std::runtime_error("Reset entered while heap service was suspended");
				}
				case 'S': saved = captureRuntimeSaveState(runtime); break;
				case 'U': applyRuntimeSaveState(runtime, saved); break;
				case 'l': ramHistory.capture(memory, nullptr, historyBaseline); break;
				case 's':
					captureRuntimeCheckpointState(runtime, historyCheckpoint);
					ramHistory.capture(memory, &historyBaseline, historyPartial);
					break;
				case 'u':
					ramHistory.capture(memory, &historyPartial, historyEnd);
					ramHistory.restore(memory, historyEnd, historyPartial);
					applyRuntimeCheckpointState(runtime, historyCheckpoint, RuntimeRestoreOrigin::HistorySeek);
					break;
				case 'X': applyRuntimeSaveState(runtime, decodeRuntimeSaveState(loadFile(argv[3]), PSX_MACHINE_SPEC.ramBytes,
					PSX_MACHINE_SPEC.gxGpuVramBytes)); break;
				case 'x': {
					std::string path;
					trace >> path;
					const auto bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
					std::ofstream file(path, std::ios::binary);
					if (!file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size())))
						throw std::runtime_error("Could not export C++ checkpoint");
					break;
				}
				default: throw std::runtime_error("Unknown fixture operation");
			}
			if (!trace) throw std::runtime_error("Incomplete fixture operation");
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
