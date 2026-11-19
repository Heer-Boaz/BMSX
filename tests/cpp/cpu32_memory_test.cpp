#include "common/endian.h"
#include "machine/cpu/value_arithmetic.h"
#include "support/number32_cpu_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
using test::Number32Machine;
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
test::Blua32TestImage program(OpCode op, u8 kind, bool known = false, bool alias = false) {
	test::Blua32TestImage image;
	image.constants = {Blua32FloatConstant{0xffa12345}, i32{DYNAMIC_RAM_BASE + 0x400}, i32{16777217}};
	image.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(known ? OpCode::LOADK : OpCode::MOV), 0, 0, known ? 1 : 0);
	writeInstruction(image.text, 2, static_cast<u8>(known ? OpCode::LOADK : OpCode::MOV), 2, known ? 0 : 2, known ? 2 : 0);
	// The source register aliases its own destination in one load variant.
	const u8 target = alias ? 0 : 2;
	const bool displaced = op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D || op == OpCode::STORE_MEM_WORDS_D;
	writeInstruction(image.text, 3, static_cast<u8>(op), target, 0, kind, displaced ? 255 : 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), target, 2, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord=0, .wordCount=5, .numParams=8, .maxStack=24},
		{.firstWord=5, .wordCount=1, .maxStack=8}};
	image.exceptionFunctionIndex = 1;
	return image;
}
void parity(Number32Machine& native, Number32Machine& scalar) {
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(a.lastPc == b.lastPc && a.causeWord == b.causeWord && a.epcWord == b.epcWord &&
		a.badAddressWord == b.badAddressWord && a.luaFaultReasonWord == b.luaFaultReasonWord &&
		a.hardHalted == b.hardHalted && a.memoryWriteBlocked == b.memoryWriteBlocked &&
		a.memoryWriteBlockedAddress == b.memoryWriteBlockedAddress,
		"memory exits retain exact fault and blocking state");
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()) &&
		std::ranges::equal(a.snapshot.objectWords(), b.snapshot.objectWords()), "memory exits publish all dirty word/tag slots");
	require(a.rootThreadRef == b.rootThreadRef && a.activeThreadRef == b.activeThreadRef, "memory exits retain the same thread roots");
	require(std::equal(native.memory.ramData(), native.memory.ramData()+native.memory.ramByteCount(), scalar.memory.ramData()),
		"memory effects, including a partial word span, match exactly");
}
void requireNative(CPU& cpu) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)].entries == 0,
		"an admitted memory operation must not escape to the interpreter");
#else
	(void)cpu;
#endif
}
void setup(Number32Machine& m, Value address, Value value) {
	auto r = m.cpu.activeThread()->currentFrame->registers;
	r.set(0, address); r.set(2, value); r.set(3, valueInteger(-1)); r.set(4, valueBool(true));
	writeLE32(m.memory.ramData() + DYNAMIC_RAM_BASE - RAM_BASE + 0x400, 0x7fa12345);
	writeLE32(m.memory.ramData() + DYNAMIC_RAM_BASE - RAM_BASE + 0x404, 0xffa12345);
	writeLE32(m.memory.ramData() + m.memory.ramByteCount() - 4, 0x3ff00000);
}
void scalarFormats() {
	const Value addresses[] = {valueInteger(DYNAMIC_RAM_BASE+0x400), valueInteger(DYNAMIC_RAM_BASE+0x401),
		valueInteger(DYNAMIC_RAM_BASE+0x402), valueInteger(RAM_BASE+PSX_MACHINE_SPEC.ramBytes-4),
		valueInteger(IO_SYS_TIME_MS), valueInteger(0xfffffffcu), valueInteger(0), valueFloat(DYNAMIC_RAM_BASE+0x400),
		valueFloatBits(0x7fc00000), valueBool(true)};
	for (auto op : {OpCode::LOAD_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM, OpCode::STORE_MEM_D})
		for (u8 kind=0; kind<=5; ++kind)
			for (Value address : addresses)
				for (int grant : {1,2,5,6,7,8,9,10,11,12,32}) {
					const auto image = program(op, kind);
					Number32Machine native(image), scalar(image, false);
					setup(native,address,valueFloatBits(0xffa12345));setup(scalar,address,valueFloatBits(0xffa12345));
					test::runCpuParity(native.cpu,scalar.cpu,grant);
					parity(native,scalar);
					if (grant == 32) requireNative(native.cpu);
				}
}
void directValuesAndAliases() {
	for (auto op : {OpCode::LOAD_MEM, OpCode::STORE_MEM}) for (u8 kind=0; kind<=5; ++kind)
		for (bool known : {false,true}) for (bool alias : {false,true})
			for (Value value : {valueInteger(16777217),valueInteger(INT32_MIN),valueFloatBits(0x80000000),
				valueFloatBits(0xffa12345),valueFloat(-2.75f),valueBool(true)}) {
				const auto image=program(op,kind,known,alias);
				Number32Machine native(image),scalar(image,false);
				setup(native,valueInteger(DYNAMIC_RAM_BASE+0x400),value);setup(scalar,valueInteger(DYNAMIC_RAM_BASE+0x400),value);
				test::runCpuParity(native.cpu,scalar.cpu,32);parity(native,scalar);requireNative(native.cpu);
#if defined(BMSX_NATIVE_GATE_PROFILE)
				if ((op==OpCode::LOAD_MEM || valueIsInteger(value) || (kind>=4 && valueIsFloat(value))) &&
					(!known || alias || kind>=4 || valueIsInteger(value))) {
					const auto& profile=native.cpu.nativeGateProfile();
					require(profile.exits[static_cast<size_t>(NativeBlockExit::ReadMemory)].entries == 0 &&
						profile.exits[static_cast<size_t>(NativeBlockExit::WriteMemory)].entries == 0,
						"ordinary RAM with admitted source types stays inside generated code");
				}
#endif
			}
}
void watchedAndCounted() {
	for (bool words : {false,true}) for (bool displaced : {false,true}) {
		const auto op=words?(displaced?OpCode::STORE_MEM_WORDS_D:OpCode::STORE_MEM_WORDS)
			:(displaced?OpCode::STORE_MEM_D:OpCode::STORE_MEM);
		const auto image=program(op,words?3:5);
		Number32Machine native(image),scalar(image,false);
		const u32 address=DYNAMIC_RAM_BASE+MAPPED_PAGE_BYTE_SIZE-4;
		for (auto* m : {&native,&scalar}) {
			setup(*m,valueInteger(address-(displaced?1020u:0)),valueInteger(16777217));
			MappedPageBinding binding;
			m->memory.bindMappedPage(address+4,MAPPED_BUS_MASTER_CPU,binding);
			binding.writeWatch.armWord(0);
		}
		test::runCpuParity(native.cpu,scalar.cpu,32);parity(native,scalar);requireNative(native.cpu);
		if (words) {
			require(native.memory.readMappedWord(address)==16777217u && native.memory.readMappedWord(address+4)==0xffffffffu &&
				native.memory.readMappedWord(address+8)==0xffa12345, "counted stores retain earlier effects before a bad third source");
			require(native.cpu.readLuaFaultReasonWord()==LUA_FAULT_REASON_INVALID_ARGUMENT, "the partial span reports its source fault");
			require(native.cpu.instructionBudgetRemaining==18,"the started counted span pays all three words before its partial source fault");
		} else {
			require(native.memory.readMappedF64LE(address)==16777217.0, "a watched F64 transfer widens Integer exactly");
#if defined(BMSX_NATIVE_GATE_PROFILE)
			require(native.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::WriteMemory)].entries==1,
				"the second page's watch leaves before either direct store");
#endif
		}
	}
}
void retainedWrites() {
	struct Device { bool ready=false; std::vector<u32> words; int lowProbes=0, highProbes=0; };
	constexpr u32 port=IO_BASE+0x5000;
	for (bool bad : {false,true}) {
		const auto image=program(OpCode::STORE_MEM,5);
		Number32Machine native(image),scalar(image,false);
		Device devices[2];
		for (int i=0;i<2;++i) {
			auto& m=i==0?native:scalar;
			setup(m,valueInteger(port),bad?valueBool(true):valueInteger(16777217));
			for (u32 address : {port,port+4}) {
				m.memory.mapIoWrite(address,&devices[i],[](void* context,u32,u32 word,MappedBusSignals) {
					static_cast<Device*>(context)->words.push_back(word);
				});
				m.memory.mapIoWriteReady(address,[](void* context,u32 address,MappedBusSignals) {
					auto& device=*static_cast<Device*>(context);
					if (address==port) ++device.lowProbes; else ++device.highProbes;
					return device.ready;
				});
			}
		}
		test::runCpuParity(native.cpu,scalar.cpu,32);parity(native,scalar);requireNative(native.cpu);
		require(native.cpu.isMemoryWriteBlocked() && native.cpu.instructionBudgetRemaining==21 &&
			native.cpu.readLuaFaultReasonWord()==0 && devices[0].words.empty(),
			"F64 readiness precedes source conversion and retains one format charge");
		for (auto* m : {&native,&scalar}) {
			const auto snapshot=m->cpu.captureRuntimeState();
			m->cpu.restoreRuntimeState(snapshot);
		}
		for (int i=0;i<2;++i) { devices[i].ready=true;(i==0?native:scalar).cpu.resumeMemoryWrite(port); }
		test::runCpuParity(native.cpu,scalar.cpu,0);parity(native,scalar);
		require(devices[0].words.empty(),"zero grant does not commit a ready retained transfer");
		test::runCpuParity(native.cpu,scalar.cpu,32);parity(native,scalar);
		require(devices[0].words==devices[1].words && devices[0].highProbes==0 && devices[1].highProbes==0,
			"F64 checks readiness at its starting address only, including after restore");
		if (bad)
			require(devices[0].words.empty() && native.cpu.readLuaFaultReasonWord()==LUA_FAULT_REASON_INVALID_ARGUMENT &&
				native.cpu.instructionBudgetRemaining==30,"a resumed source fault does not charge the format again");
		else
			require(devices[0].words==std::vector<u32>{0x10000000,0x41700000} &&
				native.cpu.instructionBudgetRemaining==32-BASE_CYCLES[static_cast<u8>(OpCode::RET)]-1,
				"a resumed transfer writes exact low/high words and pays only RET plus its one result placement");
	}
}
} // namespace
int main() {
	try {
		std::cerr << "scalar formats\n";scalarFormats();
		std::cerr << "direct values\n";directValuesAndAliases();
		std::cerr << "watches and counted stores\n";watchedAndCounted();
		std::cerr << "retained writes\n";retainedWrites();
		std::cout << "Native compact memory formats, faults, raw Float words, watches and partial spans passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n';return 1; }
}
