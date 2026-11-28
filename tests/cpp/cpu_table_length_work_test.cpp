#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/gc_heap_reference.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/table_allocation_reference.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
using namespace std::string_view_literals;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
enum class Kind { Empty, Ascending, Descending, Stale, Sparse, Terminal, ArrayEnd, HashTail };
struct Case { Kind kind; i32 boundary; };
constexpr std::array cases{Case{Kind::Empty,0}, Case{Kind::Ascending,64}, Case{Kind::Descending,4096},
	Case{Kind::Stale,0}, Case{Kind::Sparse,1 << 30}, Case{Kind::Terminal,INT32_MAX}, Case{Kind::ArrayEnd,2}, Case{Kind::HashTail,3}};
struct Program {
	test::Blua32TestImage image;
	std::array<u32,6> starts;
	Program(bool wide) {
		image.text.resize(MAPPED_PAGE_BYTE_SIZE); u32 word = 0;
		const std::array ops{OpCode::KSMI,OpCode::MOV,OpCode::LEN,OpCode::SETI,OpCode::MOV};
		const std::array a{9,6,6,10,8}, b{0,0,6,1,9}, c{37,0,0,6,0};
		for (u32 i=0;i<ops.size();++i) {
			starts[i]=word; if (wide) writeInstruction(image.text,word++,static_cast<u8>(OpCode::WIDE),0,0,0);
			writeInstruction(image.text,word++,static_cast<u8>(ops[i]),a[i],b[i],c[i]);
		}
		starts[5]=word; writeInstruction(image.text,word,static_cast<u8>(OpCode::JMP),0,63,(-(word+1u))&63u,255);
		image.functions={{.firstWord=0,.wordCount=word+1,.maxStack=12}};
	}
};
struct Machine {
	test::Blua32TestRom rom; Memory memory; IrqController irq; ExecutionAddressSpace addresses; CPU cpu;
	Machine(const Program& program,bool scalar):rom(test::encodeBlua32TestRom(RomImageDomain::System,program.image)),
		memory(MemoryInit{rom.bytes,test::cartridgeSlots()},PSX_MACHINE_SPEC.ramBytes),irq(memory),addresses(memory),cpu(memory,irq,addresses) {
		test::seedManagedFixture(cpu, addresses);
		if (scalar) cpu.setExecutionHook({[](void*,ExecutionDomainId,u32){return false;},nullptr,ALL_EXECUTION_DOMAINS_MASK,0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
};
bmsx::test::NativeTableReference makeTable(CPU& cpu,Kind kind) {
	if (kind == Kind::ArrayEnd || kind == Kind::HashTail) {
		auto table = bmsx::test::allocateTableReference(cpu, 2, kind == Kind::HashTail ? 4 : 0);
		if (kind == Kind::HashTail) table.setInteger(3, valueBool(false));
		table.setInteger(1, valueBool(false));
		table.setInteger(2, valueBool(false));
		require(table.lengthHint() == 2, "both array ends start with the same hint");
		return table;
	}
	auto table=bmsx::test::allocateTableReference(cpu, kind==Kind::Sparse||kind==Kind::Terminal?0:4096,128);
	if (kind==Kind::Ascending) for (int k=1;k<=64;++k) table.setInteger(k,valueBool(false));
	if (kind==Kind::Descending||kind==Kind::Stale) {
		const Value value=kind==Kind::Stale?valueTable(bmsx::test::allocateTableReference(cpu).address()):valueBool(false);
		for (int k=4096;k>=1;--k) table.setInteger(k,value);
	}
	if (kind==Kind::Stale) table.clearWeakEntries(false,true,[](Value){return false;});
	if (kind==Kind::Sparse||kind==Kind::Terminal) for (int bit=30;bit>=0;--bit) table.setInteger(1 << bit,valueBool(false));
	if (kind==Kind::Terminal) table.setInteger(INT32_MAX,valueBool(false));
	return table;
}
void sameSnapshot(const CpuRuntimeState& a, const CpuRuntimeState& b) {
	require(a == b
		&&a.lastPc==b.lastPc&&a.epcWord==b.epcWord&&a.causeWord==b.causeWord,
		"full guest graph, saved seed, and PC/fault state agree");
}
void lengthReadRepairsBoundaryCache() {
	Program program(false);
	for (const auto test:cases) {
		Machine m(program,true); auto table=makeTable(m.cpu,test.kind); m.cpu.activeThread()->currentFrame->registers.set(0, valueTable(table.address()));
		const auto before=m.cpu.captureRuntimeState(); const auto bytes=m.cpu.luaHeap().usedBytes();
		for (int repeat=0;repeat<3;++repeat) {
			require(TableRecord::length(&table)==test.boundary,"raw host query retains its Number-returning contract");
		}
		sameSnapshot(m.cpu.captureRuntimeState(),before);
		require(table.lengthHint()==static_cast<u32>(test.boundary) && m.cpu.luaHeap().usedBytes()==bytes, "length caches its boundary without allocating");
	}
	Machine m(program,true);auto table=makeTable(m.cpu,Kind::Descending);require(table.lengthHint()==1,"descending writes retain seed1");
	for (int i=0;i<300;++i) table.setStringKey(m.cpu.stringPool().intern("key"+std::to_string(i)),valueBool(true));
	require(table.lengthHint()==1&&TableRecord::length(&table)==4096,"redistribution retains the sequence boundary");
	table.setInteger(4097,valueBool(false));require(table.lengthHint()==4097,"an adjacent append advances the cached boundary");
	table.setInteger(4097,valueNil());require(table.lengthHint()==4096,"deleting the boundary retreats the hint");
	table.clear();require(table.lengthHint()==0&&TableRecord::length(&table)==0,"complete clear resets seed0");
	auto hash=bmsx::test::allocateTableReference(m.cpu, 0,16);hash.setInteger(1,valueBool(false));require(hash.lengthHint()==1,"eligible integer in hash updates seed");
	hash.setInteger(2,valueBool(false));require(hash.lengthHint()==2,"second eligible hash write advances one step");
}
void everyGrant() {
	for (bool wide:{false,true}) for (const auto test:cases) {
		Program program(wide);Machine generated(program,false),scalar(program,true);
		for (auto* m:{&generated,&scalar}) {
			auto r=m->cpu.activeThread()->currentFrame->registers;r.set(0, valueTable(makeTable(m->cpu,test.kind).address()));r.set(10, valueTable(bmsx::test::allocateTableReference(m->cpu, 1).address()));
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto* page=generated.cpu.activeThread()->currentFrame->executionImage->nativeCodeLookup->find(generated.rom.textAddress,0);
		require(page&&page->nativeBlocks->entries[(generated.rom.textAddress&MAPPED_PAGE_BYTE_MASK)/INSTRUCTION_BYTES],"real generated LEN region is published");
#endif
		const std::array charges{2,2,3,8,2,2};int total=0;for (int n:charges)total+=n;
		const auto heap=generated.cpu.luaHeap().usedBytes();
		for (int grant=0;grant<=total;++grant) {
			for (auto* m:{&generated,&scalar}) {
				m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);
				auto r=m->cpu.activeThread()->currentFrame->registers;r.set(6, valueInteger(91));r.set(8, valueNil());r.set(9, valueNil());bmsx::test::asReferenceTable(r.get(10), bmsx::test::GcHeap(m->cpu)).setInteger(1,valueInteger(-1));
			}
			require(test::runCpuParity(generated.cpu,scalar.cpu,grant)==RunResult::Yielded,"LEN loop remains runnable");
			int remaining=grant,completed=0;while (remaining>0)remaining-=charges[completed++];
			auto* frame=generated.cpu.activeThread()->currentFrame;auto r=frame->registers;
			require(generated.cpu.instructionBudgetRemaining==remaining&&frame->readControl(bmsx::FrameField::Pc)==generated.rom.textAddress+program.starts[completed==6?0:completed]*INSTRUCTION_BYTES,"fixed length charge and instruction frontier");
			require(r.get(6)==(completed>=3?valueInteger(test.boundary):completed>=2?r.get(0):valueInteger(91))
				&&TableRecord(generated.cpu.memory(), valuePayload(r.get(10))).getInteger(1)==(completed>=4?valueInteger(test.boundary):valueInteger(-1))&&r.get(8)==(completed>=5?valueInteger(37):valueNil()),
				"aliased Integer result and side-effecting suffix commit only at admitted instruction frontiers");
			sameSnapshot(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
			require(test::sameLanguageRam(generated.cpu, scalar.cpu), "guest heap and stack bytes match");
			require(generated.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes()
				&& generated.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
				"physical allocator and pacing words agree");
		}
		require(generated.cpu.luaHeap().usedBytes()==heap,"length performs no guest allocation");
		for (auto* m:{&generated,&scalar}) {
			m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);
			const auto ram = m->memory.captureSaveState();
			const auto before=m->cpu.captureRuntimeState();m->cpu.runUntilDepth(0,5);const auto after=m->cpu.captureRuntimeState();const int debt=m->cpu.instructionBudgetRemaining;
			m->memory.restoreSaveState(ram);
			m->cpu.restoreRuntimeState(before);m->cpu.runUntilDepth(0,5);require(m->cpu.instructionBudgetRemaining==debt,"restored table repeats the same fixed charge");sameSnapshot(m->cpu.captureRuntimeState(),after);
			auto r=m->cpu.activeThread()->currentFrame->registers;r.set(0, valueString(m->cpu.stringPool().intern("é😀\0"sv)));
			m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);m->cpu.runUntilDepth(0,5);
			require(m->cpu.instructionBudgetRemaining==-2&&m->cpu.readFrameRegister(0,6)==valueInteger(7),"String LEN uses the same fixed charge");
			r=m->cpu.activeThread()->currentFrame->registers;r.set(0, valueBool(true));r.set(8, valueNil());
			m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);m->cpu.runUntilDepth(0,5);
			require(m->cpu.instructionBudgetRemaining==-2&&(m->cpu.readCauseWord()&0x7c)==CPU_CAUSE_CODE_TRAP
				&&m->cpu.readFrameRegister(0,6)==valueBool(true)&&isNil(m->cpu.readFrameRegister(0,8)),
				"invalid LEN preserves its aliased destination and charges only the attempted instruction");
		}
	}
}
void skippedLength() {
	for (bool wide : {false, true}) {
		Program program(false); program.image.text.assign(MAPPED_PAGE_BYTE_SIZE, 0);
		writeInstruction(program.image.text, 0, static_cast<u8>(OpCode::EQ), 0, 1, 1);
		u32 word = 1;
		if (wide) writeInstruction(program.image.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(program.image.text, word++, static_cast<u8>(OpCode::LEN), 6, 0, 0);
		writeInstruction(program.image.text, word++, static_cast<u8>(OpCode::KSMI), 8, 0, 37);
		writeInstruction(program.image.text, word, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		program.image.functions = {{.firstWord=0, .wordCount=word+1, .maxStack=10}};
		Machine generated(program, false), scalar(program, true);
		for (auto* m : {&generated, &scalar}) {
			auto r = m->cpu.activeThread()->currentFrame->registers;
			r.set(0, valueTable(makeTable(m->cpu, Kind::Descending).address())); r.set(1, valueInteger(1)); r.set(6, valueInteger(91));
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 4);
		require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFrameRegister(0, 6) == valueInteger(91)
			&& generated.cpu.readFrameRegister(0, 8) == valueInteger(37), "skipped LEN is not charged and does not write its destination");
	}
}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void oneGateFrontier() {
	Program program(false);Machine m(program,false);auto* frame=m.cpu.activeThread()->currentFrame;auto r=frame->registers;
	r.set(0, valueTable(makeTable(m.cpu,Kind::Descending).address()));r.set(10, valueTable(bmsx::test::allocateTableReference(m.cpu, 1).address()));bmsx::test::asReferenceTable(r.get(10), bmsx::test::GcHeap(m.cpu)).setInteger(1,valueInteger(-1));r.set(8, valueNil());
	const auto* page=frame->executionImage->nativeCodeLookup->find(m.rom.textAddress,0);
	const auto& block=page->nativeBlocks->entries[(m.rom.textAddress&MAPPED_PAGE_BYTE_MASK)/INSTRUCTION_BYTES];
	NativeBlockRunState state{};
	state.constants = frame->executionImage->constPool;
	state.frame = frame; state.memory = &m.cpu.memory(); state.remainingCycles = 5; state.registerTop = static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top));
	const auto* exit=block->run(r, state);
	require(exit->exit==NativeBlockExit::Continue&&exit->nextPc==m.rom.textAddress+program.starts[3]*INSTRUCTION_BYTES&&state.remainingCycles==-2,
		"one actual gate invocation returns the completed fixed-cost LEN before any outer CPU loop can intervene");
	require(r.get(6)==valueInteger(4096)&&r.get(9)==valueInteger(37)&&TableRecord(m.cpu.memory(), valuePayload(r.get(10))).getInteger(1)==valueInteger(-1)&&isNil(r.get(8)),
		"Integer stays intact across scalar-work read and cached result is published before the unexecuted side effect");
}
#endif
} // namespace
int main(){try {lengthReadRepairsBoundaryCache();everyGrant();skippedLength();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	oneGateFrontier();
#endif
}catch (const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}return 0;}
