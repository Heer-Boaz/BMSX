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
#include "spec/bmsx/io.h"
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
					u32 function, count, args[8];
					trace >> function >> count;
					if (count > std::size(args)) throw std::runtime_error("Unexpected fixture arity");
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
						+ HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::Stage));
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
				case 'j': {
					u32 address, word;
					trace >> address >> word;
					int grants = 0;
					while (memory.readRamRecordWord(address) != word && grants < 16384) {
						if (scheduler.runCpuSlice(0, 1, 0u, CpuRunKind::Scheduled) != RunResult::CollectionProgress)
							throw std::runtime_error("Object sweep lost the CPU before the observed store");
						++grants;
					}
					if (grants == 0 || memory.readRamRecordWord(address) != word || !cpu.heapServiceActive())
						throw std::runtime_error("Object sweep did not suspend at the observed store");
					std::cout << grants << '\n';
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
						if (cpu.gcHeap().serviceStage() == HeapServiceGcStage::FullObjectSweep) {
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
					std::cout << cpu.gcHeap().stepFullCollection(cpu.gcHeap().fullEpochs(), words) << '\n';
					break;
				}
				case 'b': {
					std::string seed;
					trace >> seed;
					std::cout << cpu.stringPool().intern(seed) << '\n';
					break;
				}
				case 'm': {
					u32 tag, payload, queue;
					trace >> tag >> payload >> queue;
					const bool marked = cpu.gcHeap().markValue(valueFromTag(static_cast<ValueTag>(tag), payload), queue);
					std::cout << marked << ' ' << cpu.stringPool().takeMarkWork() << '\n';
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
						+ HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::Stage));
					std::cout << static_cast<int>(result) << ' ' << scheduler.nowCycles() - before
						<< ' ' << cpu.heapServiceActive() << ' ' << stage << ' '
						<< cpu.heapAllocator().occupiedBytes() << ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'q': {
					u32 stop, limit;
					trace >> stop >> limit;
					const auto base = cpu.heapAllocator().managementOffset() + HEAP_SERVICE_RECORD_OFFSET;
					const int frame = cpu.getFrameDepth() - 1;
					const auto issue = memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::InstructionPc));
					const auto before = scheduler.nowCycles();
					u32 visited = 0;
					bool reached = false;
					for (u32 grant = 0; grant < limit; ++grant) {
						if (!cpu.heapServiceActive() || cpu.allocationParked() || cpu.readFramePc(frame) != issue)
							throw std::runtime_error("Direct NEWT lost its issuing continuation");
						visited |= 1u << static_cast<u32>(cpu.gcHeap().serviceStage());
						const auto result = runtime.cpuExecution.runSuspendedUntilDepth(runtime, 0, 1);
						const auto stage = memory.readRamRecordWord(base + static_cast<u32>(HeapServiceRecordField::Stage));
						if (stage != stop) continue;
						if ((stop == static_cast<u32>(HeapServiceRecordStage::Idle) && cpu.readLuaFaultReasonWord() == 0u)
							|| scheduler.nowCycles() <= before)
							throw std::runtime_error("Direct NEWT did not retire at its expected boundary");
						std::cout << static_cast<int>(result) << ' ' << scheduler.nowCycles() - before << ' '
							<< cpu.heapServiceActive() << ' ' << stage << ' ' << cpu.heapAllocator().occupiedBytes()
							<< ' ' << cpu.luaHeap().usedBytes() << ' ' << visited << '\n';
						reached = true;
						break;
					}
					if (!reached) throw std::runtime_error("Direct NEWT did not reach the fixture stage");
					break;
				}
				case 'K': {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_NATIVE_GATE_PROFILE)
					char opcode;
					trace >> opcode;
					if (opcode != 'N' && opcode != 'C' && opcode != 'F')
						throw std::runtime_error("Expected generated NEWT, CLOSURE or SETFIELD");
					const bool createTable = opcode == 'N';
					const bool growField = opcode == 'F';
					const auto gate = growField ? NativeBlockExit::WriteField
						: createTable ? NativeBlockExit::AllocateTable : NativeBlockExit::CreateClosure;
					const u32 expectedStage = growField ? static_cast<u32>(HeapServiceTableGrowthStage::Scheduled)
						: static_cast<u32>(createTable ? HeapServiceRecordStage::Scheduled : HeapServiceRecordStage::Direct);
					const u32 expectedKind = growField ? 1u
						: static_cast<u32>(createTable ? HeapServiceRecordKind::Table : HeapServiceRecordKind::CanonicalClosure);
					cpu.prepareSystemNativeCode();
					const auto& allocation = cpu.nativeGateProfile().exits[static_cast<size_t>(gate)];
					const auto before = allocation;
					auto result = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
					// The generated entry wrapper first reserves its static Closure.
					for (int grant = 0; grant < 8 && allocation.entries == before.entries && result == RunResult::Yielded; ++grant)
						result = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
					const u32 management = cpu.heapAllocator().managementOffset();
					const auto stage = memory.readRamRecordWord(management + (growField
						? HEAP_SERVICE_TABLE_GROWTH_OFFSET + static_cast<u32>(HeapServiceTableGrowthField::Stage)
						: HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::Stage)));
					const auto kind = memory.readRamRecordWord(management + (growField
						? HEAP_SERVICE_TABLE_GROWTH_OFFSET + static_cast<u32>(HeapServiceTableGrowthField::Immediate)
						: HEAP_SERVICE_RECORD_CONTROL_OFFSET + static_cast<u32>(HeapServiceRecordControlField::Kind)));
					if (allocation.entries != before.entries + 1 || allocation.returns != before.returns + 1
						|| allocation.resumes != before.resumes || allocation.exceptions != before.exceptions)
						throw std::runtime_error("The generated allocation exit did not hand off exactly once");
					if (result != RunResult::Yielded || !cpu.heapServiceActive()
						|| stage != expectedStage || kind != expectedKind
						|| cpu.readFramePc(cpu.getFrameDepth() - 1) != cpu.readCurrentInstructionPc())
						throw std::runtime_error("The generated allocation did not suspend at its own instruction");
					std::cout << allocation.entries - before.entries << ' ' << stage << ' ' << kind;
					if (growField) std::cout << ' ' << cpu.heapAllocator().occupiedBytes() << ' ' << cpu.luaHeap().usedBytes();
					std::cout << '\n';
#else
					throw std::runtime_error("Generated allocation proof requires BMSX_NATIVE_GATE_PROFILE and native blocks");
#endif
					break;
				}
				case 'a':
				case 'd':
				case 'k': {
					auto& frames = runtime.frameScheduler;
					const auto before = frames.lastTickSequence;
					const auto cycles = scheduler.nowCycles();
					const auto admitted = cpu.gcHeap().serviceStage();
					const int result = op == 'a' ? static_cast<int>(frames.advanceLogicalTick(runtime, 0))
						: static_cast<int>(frames.stepInstruction(runtime, 1));
					if (op == 'k') {
						if (admitted != HeapServiceGcStage::MaintenanceTrace && admitted != HeapServiceGcStage::MaintenanceRemark
							&& admitted != HeapServiceGcStage::MaintenanceRootHead && admitted != HeapServiceGcStage::MaintenanceRootBanks)
							throw std::runtime_error("Expected an active allocation-recovery mark stage");
						for (int grant = 1; cpu.gcHeap().serviceStage() == admitted && grant < 65536; ++grant)
							frames.stepInstruction(runtime, 1);
						if (cpu.gcHeap().serviceStage() == admitted || scheduler.nowCycles() <= cycles)
							throw std::runtime_error("Allocation recovery did not retire the timed mark stage");
					}
					const u32 management = cpu.heapAllocator().managementOffset();
					std::cout << result << ' ' << (op == 'k' ? 1 : scheduler.nowCycles() - cycles) << ' ' << (frames.lastTickSequence != before)
						<< ' ' << cpu.allocationParked() << ' ' << cpu.allocationReady() << ' ' << cpu.heapServiceActive()
						<< ' ' << static_cast<u32>(cpu.gcHeap().serviceStage())
						<< ' ' << memory.readRamRecordWord(management + HEAP_SERVICE_RECORD_OFFSET)
						<< ' ' << memory.readIoU32(IO_IRQ_FLAGS)
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
				case 'p': {
					i64 cycles;
					trace >> cycles;
					auto& frames = runtime.frameScheduler;
					const auto before = scheduler.nowCycles();
					const auto tick = frames.lastTickSequence;
					const bool completed = frames.runCyclesToNextLogicalTick(runtime, cycles);
					std::cout << completed << ' ' << scheduler.nowCycles() - before << ' '
						<< frames.lastTickSequence - tick << ' ' << cpu.heapServiceActive() << ' '
						<< static_cast<u32>(cpu.gcHeap().serviceStage()) << ' ' << cpu.isHaltedUntilIrq() << '\n';
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
				case 'M':
				case 'Q': {
					u32 address;
					trace >> address;
					MappedBusSignals signals = MAPPED_BUS_MASTER_CPU;
					if (op == 'Q') {
						u32 raw;
						trace >> raw;
						signals = static_cast<MappedBusSignals>(raw);
					}
					const u32 sequence = memory.readBusFaultSequence();
					const u32 value = memory.readMappedBusU32LE(address, signals);
					std::cout << value << ' ' << (memory.readBusFaultSequence() != sequence) << '\n';
					break;
				}
				case 'P': {
					const auto depth = cpu.getFrameDepth();
					std::cout << depth << ' ' << cpu.readFramePc(depth - 1) << '\n';
					break;
				}
				case 'N': cpu.requestNonMaskableInterrupt(); break;
				case 'h': cpu.clearHaltUntilIrq(); break;
				case 'i': {
					u32 flags;
					trace >> flags;
					runtime.machine.irqController.raise(flags);
					break;
				}
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
