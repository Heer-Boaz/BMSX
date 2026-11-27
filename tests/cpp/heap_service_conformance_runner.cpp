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
#include "spec/bmsx/rom_header.h"

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
					const auto pending = memory.readRamRecordWord(cpu.heapAllocator().managementOffset() + HEAP_SERVICE_EXEC_PENDING_OFFSET);
					std::cout << static_cast<int>(result) << ' ' << cycles - cpu.instructionBudgetRemaining << ' '
						<< cpu.heapServiceActive() << ' ' << pending << ' ' << memory.ramBusEnd()
						<< ' ' << static_cast<int>(cpu.activeCartridgeSlot()) << '\n';
					break;
				}
				case 'J': {
					int cycles, mode;
					trace >> cycles >> mode;
					const auto result = scheduler.runCpuSlice(0, cycles, 0u, mode == 0 ? CpuRunKind::Direct : CpuRunKind::Scheduled);
					const auto stage = memory.readRamRecordWord(cpu.heapAllocator().managementOffset()
						+ HEAP_SERVICE_CLOSURE_OFFSET + static_cast<u32>(HeapServiceClosureField::Destination));
					std::cout << static_cast<int>(result) << ' ' << cycles - cpu.instructionBudgetRemaining << ' '
						<< cpu.heapServiceActive() << ' ' << stage << ' ' << cpu.heapAllocator().occupiedBytes()
						<< ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'L': {
					int cycles;
					trace >> cycles;
					const auto result = scheduler.runCpuSlice(0, cycles, 0u, CpuRunKind::Scheduled);
					std::cout << static_cast<int>(result) << ' ' << cycles - cpu.instructionBudgetRemaining << ' '
						<< cpu.heapServiceActive() << ' ' << cpu.gcHeap().fullEpochs()
						<< ' ' << static_cast<int>(cpu.gcHeap().phase()) << ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'j': {
					u32 address, word;
					trace >> address >> word;
					int grants = 0;
					while (memory.readRamRecordWord(address) != word && grants < 16384) {
						if (scheduler.runCpuSlice(0, 1, 0u, CpuRunKind::Scheduled) != RunResult::Yielded || !cpu.heapServiceActive())
							throw std::runtime_error("Object sweep lost the CPU before the observed store");
						++grants;
					}
					if (grants == 0 || memory.readRamRecordWord(address) != word || !cpu.heapServiceActive())
						throw std::runtime_error("Object sweep did not suspend at the observed store");
					std::cout << grants << '\n';
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
				case 'o': {
#if defined(BMSX_NATIVE_GATE_PROFILE)
					u32 function;
					int cycles;
					trace >> function >> cycles;
					const auto depth = cpu.getFrameDepth();
					const auto& reads = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ReadMemory)];
					const auto readCount = reads.entries;
					cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, function);
					if (runtime.cpuExecution.runSuspendedUntilDepth(runtime, depth, cycles) != CpuSuspendedRunResult::Completed)
						throw std::runtime_error("Ordinary System call did not complete.");
					std::cout << asInteger(cpu.readCompletionValues().get(0)) << ' ' << reads.entries - readCount << '\n';
#else
					throw std::runtime_error("Ordinary System native aperture evidence requires BMSX_NATIVE_GATE_PROFILE.");
#endif
					break;
				}
				case 'n': {
#if defined(BMSX_NATIVE_GATE_PROFILE)
					const auto& profile = cpu.nativeGateProfile();
					std::cout << "native-firmware " << profile.privateFirmwareEntries << ' '
						<< profile.privateFirmwareCycles << ' ' << profile.lastPrivateFirmwareEntryPc << ' '
						<< cpu.heapServiceResult() << ' '
						<< profile.exits[static_cast<size_t>(NativeBlockExit::WriteMemory)].entries << '\n';
#else
					throw std::runtime_error("Firmware native PC evidence requires BMSX_NATIVE_GATE_PROFILE.");
#endif
					break;
				}
				case 't': {
#if defined(BMSX_NATIVE_GATE_PROFILE)
					const auto& exits = cpu.nativeGateProfile().exits;
					std::cout << "firmware-transfer " << cpu.heapServiceResult() << ' '
						<< exits[static_cast<size_t>(NativeBlockExit::PrivateCall)].entries << ' '
						<< exits[static_cast<size_t>(NativeBlockExit::PrivateReturn)].entries << ' '
						<< exits[static_cast<size_t>(NativeBlockExit::CreateClosure)].entries << '\n';
#else
					throw std::runtime_error("Fixed transfer evidence requires BMSX_NATIVE_GATE_PROFILE.");
#endif
					break;
				}
				case 'q': {
					int depth, cycles;
					trace >> depth >> cycles;
					const auto before = scheduler.nowCycles();
					const auto result = runtime.cpuExecution.runSuspendedUntilDepth(runtime, depth, cycles);
					std::cout << static_cast<unsigned>(result) << ' ' << scheduler.nowCycles() - before
						<< ' ' << cpu.heapServiceActive() << ' ' << cpu.getFrameDepth()
						<< ' ' << cpu.readFramePc(depth - 1) << ' ' << cpu.isHaltedUntilIrq() << '\n';
					break;
				}
				case 'D': {
					int cycles;
					trace >> cycles;
					const auto before = scheduler.nowCycles();
					const auto result = runtime.cpuExecution.runSuspendedUntilDepth(runtime, 0, cycles);
					const auto stage = memory.readRamRecordWord(cpu.heapAllocator().managementOffset()
						+ HEAP_SERVICE_CLOSURE_OFFSET + static_cast<u32>(HeapServiceClosureField::Destination));
					std::cout << static_cast<int>(result) << ' ' << scheduler.nowCycles() - before
						<< ' ' << cpu.heapServiceActive() << ' ' << stage << ' '
						<< cpu.heapAllocator().occupiedBytes() << ' ' << cpu.luaHeap().usedBytes() << '\n';
					break;
				}
				case 'K': {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_NATIVE_GATE_PROFILE)
					char opcode;
					trace >> opcode;
					if (opcode != 'C' && opcode != 'F' && opcode != 'R' && opcode != 'Y' && opcode != 'A' && opcode != 'V')
						throw std::runtime_error("Expected generated CLOSURE, SETFIELD, RAWSET, coroutine.create, prepared CALL or VARARG");
					const bool growField = opcode == 'F';
					const bool rawSet = opcode == 'R';
					const bool coroutine = opcode == 'Y';
					const bool prepared = opcode == 'A', vararg = opcode == 'V';
					const bool acquiresFrameSpace = prepared || vararg;
					const auto gate = vararg ? NativeBlockExit::Vararg : rawSet || coroutine || prepared ? NativeBlockExit::Call
						: growField ? NativeBlockExit::WriteField : NativeBlockExit::CreateClosure;
					if (rawSet) {
						auto& frame = *cpu.activeThread()->currentFrame;
						const u32 closure = frame.readControl(FrameField::Closure);
						const std::array original{frame.registers.get(0), frame.registers.get(1), frame.registers.get(2), frame.registers.get(3)};
						const std::array overwrite{original[0], valueInteger(-1), valueInteger(1), original[3]};
						// Use the restored completion frame for the first overwrite,
						// then warm that exact guest CALL PC with ordinary activations.
						frame.registers.set(1, overwrite[1]);
						frame.registers.set(2, overwrite[2]);
						for (int visit = 0; visit < 128; ++visit) {
							if (visit != 0) cpu.beginCompletionCall(closure, {overwrite.data(), overwrite.size()});
							auto warm = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
							for (int grant = 0; grant < 8 && warm == RunResult::Yielded && !cpu.heapServiceActive(); ++grant)
								warm = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
							if (warm != RunResult::Halted || cpu.heapServiceActive())
								throw std::runtime_error("Warm RAWSET overwrite did not complete without a service (grant "
									+ std::to_string(static_cast<int>(warm)) + ", pinned " + std::to_string(cpu.heapServiceActive())
									+ ", visit " + std::to_string(visit) + ", target " + std::to_string(valuePayload(original[0]))
									+ ", PC " + std::to_string(cpu.readCurrentInstructionPc()) + ")");

						}
						cpu.beginCompletionCall(closure, {original.data(), original.size()});
					}
					if (coroutine) {
						auto& frame = *cpu.activeThread()->currentFrame;
						const u32 closure = frame.readControl(FrameField::Closure);
						const std::array original{frame.registers.get(0), frame.registers.get(1), frame.registers.get(2)};
						// Same CALL site, a real nonallocating builtin with a valid argument.
						const std::array warmArgs{valueBuiltinFunction(BuiltinFunctionId::GetMetatable), original[2]};
						frame.registers.set(0, warmArgs[0]);
						frame.registers.set(1, warmArgs[1]);
						for (int visit = 0; visit < 128; ++visit) {
							if (visit != 0) cpu.beginCompletionCall(closure, {warmArgs.data(), warmArgs.size()});
							auto warm = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
							for (int grant = 0; grant < 8 && warm == RunResult::Yielded && !cpu.heapServiceActive(); ++grant)
								warm = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
							if (warm != RunResult::Halted || cpu.heapServiceActive())
								throw std::runtime_error("Warm read-only builtin did not finish without a resident service");
						}
						cpu.beginCompletionCall(closure, {original.data(), original.size()});
					}
					if (prepared) {
						auto& frame = *cpu.activeThread()->currentFrame;
						const int parentDepth = cpu.getFrameDepth() - 1;
						const u32 closure = frame.readControl(FrameField::Closure);
						const std::array original{frame.registers.get(0), frame.registers.get(1), frame.registers.get(2)};
						// Warm the same true CALL PC at the same depth with a
						// builtin that cannot add a language frame.
						const std::array warmArgs{valueBuiltinFunction(BuiltinFunctionId::RawGet), original[1], original[2]};
						frame.registers.set(0, warmArgs[0]);
						for (int visit = 0; visit < 128; ++visit) {
							if (visit != 0) cpu.beginCompletionCall(closure, {warmArgs.data(), warmArgs.size()});
							auto warm = scheduler.runCpuSlice(parentDepth, 65536, 0u, CpuRunKind::Scheduled);
							if (warm != RunResult::Halted || cpu.heapServiceActive() || cpu.getFrameDepth() != parentDepth)
								throw std::runtime_error("Warm prepared CALL site changed its parent frontier");
						}
						cpu.beginCompletionCall(closure, {original.data(), original.size()});
					}
					if (vararg) {
						auto& frame = *cpu.activeThread()->currentFrame;
						const u32 closure = frame.readControl(FrameField::Closure);
						const std::array warm{frame.thread->stack.get(frame.readWindow(FrameField::VarargBase))};
						for (int visit = 0; visit < 128; ++visit) {
							if (visit != 0) cpu.beginCompletionCall(closure, {warm.data(), warm.size()});
							const auto outcome = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
							if (outcome != RunResult::Halted || cpu.heapServiceActive())
								throw std::runtime_error("A fitting VARARG suspend would invalidate the native gate warm-up");
						}
						std::array<Value, 33> args;
						for (int i = 0; i < static_cast<int>(args.size()); ++i) args[i] = valueInteger(74 + i);
						cpu.beginCompletionCall(closure, {args.data(), args.size()});
					}
					cpu.prepareSystemNativeCode();
					const auto& allocation = cpu.nativeGateProfile().exits[static_cast<size_t>(gate)];
					const auto before = allocation;
					auto result = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
					// Startup and the entry wrapper can each reserve ROM closures
					// before this guest instruction, on separate firmware grants.
					for (int grant = 0; grant < 512 && allocation.entries == before.entries && result == RunResult::Yielded; ++grant)
						result = scheduler.runCpuSlice(0, 65536, 0u, CpuRunKind::Scheduled);
					const u32 management = cpu.heapAllocator().managementOffset();
					const u32 frontier = management + HEAP_SERVICE_BIOS_CALL_OFFSET;
					const auto completion = static_cast<HeapServiceBiosCallKind>(memory.readRamRecordWord(
						frontier + static_cast<u32>(HeapServiceBiosCallField::Kind)));
					if (allocation.entries != before.entries + 1 || allocation.returns != before.returns + 1
						|| allocation.resumes != before.resumes || allocation.exceptions != before.exceptions)
						throw std::runtime_error("The generated allocation exit did not hand off exactly once: "
							+ std::to_string(allocation.entries - before.entries) + " entries, "
							+ std::to_string(allocation.returns - before.returns) + " returns at PC "
							+ std::to_string(cpu.readCurrentInstructionPc()) + ", run result " + std::to_string(static_cast<int>(result)));
					const u32 caller = cpu.readFramePc(cpu.getFrameDepth() - 1);
					if (result != RunResult::Yielded || !cpu.heapServiceActive())
						throw std::runtime_error("The generated allocation did not suspend");
					if (growField || rawSet || coroutine || acquiresFrameSpace) {
						const u32 imageAddress = SYSTEM_ROM_BASE
							+ memory.readMappedU32LE(SYSTEM_ROM_BASE + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET);
						const u32 descriptor = memory.readMappedU32LE(imageAddress + HEAP_SERVICE_IMAGE_ADDRESS_OFFSET);
						const u32 root = memory.readMappedU32LE(descriptor + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET
							+ static_cast<u32>(acquiresFrameSpace ? HeapServiceOperation::ReserveFrameSpace : coroutine ? HeapServiceOperation::CreateCoroutine : HeapServiceOperation::TableGrow) * sizeof(u32));
						const u32 activeRoot = memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + static_cast<u32>(FrameField::Function));
						const u32 origin = acquiresFrameSpace
							? memory.readRamRecordWord(management + HEAP_SERVICE_RESIDENT_OFFSET + static_cast<u32>(HeapServiceResidentField::IssuePc))
							: memory.readRamRecordWord(frontier + static_cast<u32>(HeapServiceBiosCallField::InstructionPc));
						const auto want = acquiresFrameSpace ? HeapServiceBiosCallKind::Idle
							: rawSet || coroutine ? HeapServiceBiosCallKind::Call : HeapServiceBiosCallKind::Discard;
						const u32 receiver = vararg ? FRAME_RESIDENT_PLACE_WINDOW : FRAME_RESIDENT_PREPARED_ENTRY;
						if (acquiresFrameSpace && memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + static_cast<u32>(FrameField::Flags)) != (FRAME_RESIDENT_ACTIVATION | receiver))
							throw std::runtime_error("The fixed root did not retain its prepared-activation receiving mode");
						if (completion != want || cpu.allocationParked() || activeRoot != root
							|| origin != cpu.readCurrentInstructionPc() || caller != cpu.lastPc + INSTRUCTION_BYTES)
							throw std::runtime_error("The generated instruction did not issue its bound resident continuation");
					} else if (memory.readRamRecordWord(management + HEAP_SERVICE_CLOSURE_OFFSET
							+ static_cast<u32>(HeapServiceClosureField::Destination)) == 0u || caller != cpu.readCurrentInstructionPc()) {
						throw std::runtime_error("The generated allocation did not suspend at its own instruction");
					}
					std::cout << allocation.entries - before.entries;
					if (growField || rawSet || coroutine || acquiresFrameSpace)
						std::cout << ' ' << (acquiresFrameSpace ? (FRAME_RESIDENT_ACTIVATION | (vararg ? FRAME_RESIDENT_PLACE_WINDOW : FRAME_RESIDENT_PREPARED_ENTRY)) : static_cast<u32>(completion))
						<< ' ' << cpu.heapAllocator().occupiedBytes() << ' ' << cpu.luaHeap().usedBytes();
					std::cout << '\n';
#else
					throw std::runtime_error("Generated allocation proof requires BMSX_NATIVE_GATE_PROFILE and native blocks");
#endif
					break;
				}
				case 'a':
				case 'd': {
					auto& frames = runtime.frameScheduler;
					const auto before = frames.lastTickSequence;
					const auto cycles = scheduler.nowCycles();
					const int result = op == 'a' ? static_cast<int>(frames.advanceLogicalTick(runtime, 0))
						: static_cast<int>(frames.stepInstruction(runtime, 1));
					const u32 management = cpu.heapAllocator().managementOffset();
					std::cout << result << ' ' << (scheduler.nowCycles() - cycles) << ' ' << (frames.lastTickSequence != before)
						<< ' ' << cpu.allocationParked() << ' ' << cpu.allocationReady() << ' ' << cpu.heapServiceActive()
						<< ' ' << memory.readRamRecordWord(management + HEAP_SERVICE_CLOSURE_OFFSET)
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
						<< cpu.isHaltedUntilIrq() << '\n';
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
				case 'c': {
					const auto values = runtime.readCompletionValues();
					std::cout << values.size();
					for (size_t i = 0; i < values.size(); ++i) {
						const auto value = values.get(i);
						std::cout << ' ' << static_cast<u32>(valueTag(value)) << ' ' << valuePayload(value);
					}
					std::cout << '\n';
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
				case ':': {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_NATIVE_GATE_PROFILE)
					const auto& profile = cpu.nativeGateProfile();
					std::cout << profile.privateFirmwareEntries << ' '
						<< profile.exits[static_cast<size_t>(NativeBlockExit::ReadMemory)].entries << ' '
						<< profile.exits[static_cast<size_t>(NativeBlockExit::WriteMemory)].entries << '\n';
#else
					throw std::runtime_error("The native Value port proof requires the gate profile.");
#endif
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
				case '!': {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_NATIVE_GATE_PROFILE)
					int grant, native, mode;
					trace >> grant >> native >> mode;
					if (native) {
						auto& frame = *cpu.activeThread()->currentFrame;
						const auto closure = frame.readControl(FrameField::Closure);
						const auto original = frame.registers.get(0);
						const std::array warm{valueInteger(73)};
						const std::array wanted{original};
						frame.registers.set(0, warm[0]);
						for (int visit = 0; visit < 128; ++visit) {
							if (visit != 0) cpu.beginCompletionCall(closure, {warm.data(), warm.size()});
							if (cpu.runUntilDepth(0, 4096) != RunResult::Halted || cpu.heapServiceActive())
								throw std::runtime_error("Warm scalar closed SETUP did not finish as an ordinary write");
						}
						cpu.prepareSystemNativeCode();
						cpu.beginCompletionCall(closure, {wanted.data(), wanted.size()});
					} else cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
					const auto gate = static_cast<size_t>(NativeBlockExit::WriteUpvalue);
					const auto before = cpu.nativeGateProfile().exits[gate];
					const auto result = scheduler.runCpuSlice(0, grant, 0u, mode == 0 ? CpuRunKind::Direct : CpuRunKind::Scheduled);
					const auto after = cpu.nativeGateProfile().exits[gate];
					std::cout << static_cast<int>(result) << ' ' << grant - cpu.instructionBudgetRemaining << ' '
						<< cpu.heapServiceActive() << ' ' << after.entries - before.entries << ' ' << after.returns - before.returns
						<< ' ' << after.resumes - before.resumes << ' ' << after.exceptions - before.exceptions << '\n';
#else
					throw std::runtime_error("SETUP gate proof requires BMSX_NATIVE_GATE_PROFILE and native blocks");
#endif
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
				case '_': {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_NATIVE_GATE_PROFILE)
					cpu.prepareSystemNativeCode();
					const auto gate = static_cast<size_t>(NativeBlockExit::ScalarBoundary);
					const auto before = cpu.nativeGateProfile().exits[gate].entries;
					int cycles;
					trace >> cycles;
					cpu.runUntilDepth(0, cycles);
					std::cout << cpu.nativeGateProfile().exits[gate].entries - before << '\n';
#else
					throw std::runtime_error("Vector capture admission evidence requires native profiling.");
#endif
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
