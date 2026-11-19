#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
using namespace std::string_view_literals;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
enum class Kind { Empty, Ascending, Descending, Stale, Sparse, Terminal };
struct Case { Kind kind; i32 boundary; int probes; };
constexpr std::array cases{Case{Kind::Empty,0,1}, Case{Kind::Ascending,64,2}, Case{Kind::Descending,4096,26},
	Case{Kind::Stale,0,1}, Case{Kind::Sparse,1 << 30,61}, Case{Kind::Terminal,INT32_MAX,32}};
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
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*,ExecutionDomainId,u32){return false;},nullptr,ALL_EXECUTION_DOMAINS_MASK,0});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else cpu.prepareSystemNativeCode();
#endif
	}
};
Table* makeTable(CPU& cpu,Kind kind) {
	auto* table=cpu.createTable(kind==Kind::Sparse||kind==Kind::Terminal?0:4096,128);
	if (kind==Kind::Ascending) for (int k=1;k<=64;++k) table->setInteger(k,valueBool(false));
	if (kind==Kind::Descending||kind==Kind::Stale) {
		const Value value=kind==Kind::Stale?valueTable(cpu.gcHeap().reference(cpu.createTable())):valueBool(false);
		for (int k=4096;k>=1;--k) table->setInteger(k,value);
	}
	if (kind==Kind::Stale) table->clearWeakEntries(false,true,[](Value){return false;});
	if (kind==Kind::Sparse||kind==Kind::Terminal) for (int bit=30;bit>=0;--bit) table->setInteger(1 << bit,valueBool(false));
	if (kind==Kind::Terminal) table->setInteger(INT32_MAX,valueBool(false));
	return table;
}
void sameSnapshot(const CpuRuntimeState& a,const CpuRuntimeState& b) {
	require(std::ranges::equal(a.snapshot.words(),b.snapshot.words())&&std::ranges::equal(a.snapshot.objectWords(),b.snapshot.objectWords())
		&&a.nextObjectHashId==b.nextObjectHashId&&a.luaHeap.trackedBytes==b.luaHeap.trackedBytes&&a.luaHeap.nextCollectionBytes==b.luaHeap.nextCollectionBytes
		&&a.lastPc==b.lastPc&&a.epcWord==b.epcWord&&a.causeWord==b.causeWord,
		"full guest graph, saved seed, heap thresholds and PC/fault state agree");
}
void pureSearchAndSeed() {
	Program program(false);
	for (const auto test:cases) {
		Machine m(program,true); auto* table=makeTable(m.cpu,test.kind); m.cpu.activeThread()->currentFrame->registers.set(0, valueTable(m.cpu.gcHeap().reference(table)));
		const auto before=m.cpu.captureRuntimeState();
		for (int repeat=0;repeat<3;++repeat) {
			u32 probes; require(Table::length(table,&probes)==test.boundary&&probes==static_cast<u32>(test.probes),"exact literal logical probe count and border");
			require(Table::length(table)==test.boundary,"raw host query retains its Number-returning contract");
		}
		sameSnapshot(m.cpu.captureRuntimeState(),before);
	}
	Machine m(program,true);auto* table=makeTable(m.cpu,Kind::Descending);require(table->lengthHint()==1,"descending writes retain seed1");
	for (int i=0;i<300;++i) table->setStringKey(m.cpu.stringPool().intern("key"+std::to_string(i)),valueBool(true));
	u32 probes;require(table->lengthHint()==1&&Table::length(table,&probes)==4096&&probes==26,"redistribution retains seed and semantic probes");
	table->setInteger(2,valueBool(false));require(table->lengthHint()==2,"adjacent overwrite advances only one step");
	table->setInteger(2,valueNil());require(table->lengthHint()==1,"adjacent deletion retreats one step");
	table->clear();require(table->lengthHint()==0&&Table::length(table,&probes)==0&&probes==1,"complete clear resets seed0");
	auto* hash=m.cpu.createTable(0,16);hash->setInteger(1,valueBool(false));require(hash->lengthHint()==1,"eligible integer in hash updates seed");
	hash->setInteger(2,valueBool(false));require(hash->lengthHint()==2,"second eligible hash write advances one step");
}
void everyGrant() {
	for (bool wide:{false,true}) for (const auto test:cases) {
		Program program(wide);Machine generated(program,false),scalar(program,true);
		for (auto* m:{&generated,&scalar}) {
			auto r=m->cpu.activeThread()->currentFrame->registers;r.set(0, valueTable(m->cpu.gcHeap().reference(makeTable(m->cpu,test.kind))));r.set(10, valueTable(m->cpu.gcHeap().reference(m->cpu.createTable(1))));
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto* page=generated.cpu.activeThread()->currentFrame->executionImage->nativeCodeLookup->find(generated.rom.textAddress,0);
		require(page&&page->nativeBlocks->entries[(generated.rom.textAddress&MAPPED_PAGE_BYTE_MASK)/INSTRUCTION_BYTES],"real generated LEN region is published");
#endif
		const std::array charges{2,2,3+6*test.probes,8,2,2};int total=0;for (int n:charges)total+=n;
		const auto heap=generated.cpu.luaHeap().usedBytes();
		for (int grant=0;grant<=total;++grant) {
			for (auto* m:{&generated,&scalar}) {
				m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);
				auto r=m->cpu.activeThread()->currentFrame->registers;r.set(6, valueInteger(91));r.set(8, valueNil());r.set(9, valueNil());asTable(r.get(10), m->cpu.gcHeap())->setInteger(1,valueInteger(-1));
			}
			require(test::runCpuParity(generated.cpu,scalar.cpu,grant)==RunResult::Yielded,"LEN loop remains runnable");
			int remaining=grant,completed=0;while (remaining>0)remaining-=charges[completed++];
			auto* frame=generated.cpu.activeThread()->currentFrame;auto r=frame->registers;
			require(generated.cpu.instructionBudgetRemaining==remaining&&frame->pc==generated.rom.textAddress+program.starts[completed==6?0:completed]*INSTRUCTION_BYTES,"literal full-P debt and instruction frontier");
			require(r.get(6)==(completed>=3?valueInteger(test.boundary):completed>=2?r.get(0):valueInteger(91))
				&&asTable(r.get(10), generated.cpu.gcHeap())->getInteger(1)==(completed>=4?valueInteger(test.boundary):valueInteger(-1))&&r.get(8)==(completed>=5?valueInteger(37):valueNil()),
				"aliased Integer result and side-effecting suffix commit only at admitted instruction frontiers");
			sameSnapshot(generated.cpu.captureRuntimeState(),scalar.cpu.captureRuntimeState());
		}
		require(generated.cpu.luaHeap().usedBytes()==heap,"length performs no guest allocation");
		for (auto* m:{&generated,&scalar}) {
			m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);
			const auto before=m->cpu.captureRuntimeState();m->cpu.runUntilDepth(0,5);const auto after=m->cpu.captureRuntimeState();const int debt=m->cpu.instructionBudgetRemaining;
			m->cpu.restoreRuntimeState(before);m->cpu.runUntilDepth(0,5);require(m->cpu.instructionBudgetRemaining==debt,"restored seed repeats exact logical work");sameSnapshot(m->cpu.captureRuntimeState(),after);
			auto r=m->cpu.activeThread()->currentFrame->registers;r.set(0, valueString(m->cpu.stringPool().intern("é😀\0"sv)));
			m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);m->cpu.runUntilDepth(0,5);
			require(m->cpu.instructionBudgetRemaining==-2&&m->cpu.readFrameRegister(0,6)==valueInteger(7),"String LEN ignores stale Table probe work and remains base3");
			r=m->cpu.activeThread()->currentFrame->registers;r.set(0, valueBool(true));r.set(8, valueNil());
			m->cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,m->rom.functionAddresses[0],m->rom.textAddress);m->cpu.runUntilDepth(0,5);
			require(m->cpu.instructionBudgetRemaining==-2&&(m->cpu.readCauseWord()&0x7c)==CPU_CAUSE_CODE_TRAP
				&&m->cpu.readFrameRegister(0,6)==valueBool(true)&&isNil(m->cpu.readFrameRegister(0,8)),
				"invalid LEN preserves its aliased destination and has no logical presence work");
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
			r.set(0, valueTable(m->cpu.gcHeap().reference(makeTable(m->cpu, Kind::Descending)))); r.set(1, valueInteger(1)); r.set(6, valueInteger(91));
		}
		test::runCpuParity(generated.cpu, scalar.cpu, 4);
		require(generated.cpu.instructionBudgetRemaining == 0 && generated.cpu.readFrameRegister(0, 6) == valueInteger(91)
			&& generated.cpu.readFrameRegister(0, 8) == valueInteger(37), "skipped LEN has no presence work or destination commit");
	}
}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void oneGateFrontier() {
	Program program(false);Machine m(program,false);auto* frame=m.cpu.activeThread()->currentFrame;auto r=frame->registers;
	r.set(0, valueTable(m.cpu.gcHeap().reference(makeTable(m.cpu,Kind::Descending))));r.set(10, valueTable(m.cpu.gcHeap().reference(m.cpu.createTable(1))));asTable(r.get(10), m.cpu.gcHeap())->setInteger(1,valueInteger(-1));r.set(8, valueNil());
	const auto* page=frame->executionImage->nativeCodeLookup->find(m.rom.textAddress,0);
	const auto& block=page->nativeBlocks->entries[(m.rom.textAddress&MAPPED_PAGE_BYTE_MASK)/INSTRUCTION_BYTES];
	NativeBlockRunState state{};
	state.registers = r; state.constants = frame->executionImage->constPool.view();
	state.frame = frame; state.heap = &m.cpu.gcHeap(); state.remainingCycles = 18; state.registerTop = frame->top;
	const auto* exit=block->run(state);
	require(exit->exit==NativeBlockExit::Continue&&exit->nextPc==m.rom.textAddress+program.starts[3]*INSTRUCTION_BYTES&&state.remainingCycles==-145,
		"one actual gate invocation returns completed LEN debt before any outer CPU loop can intervene");
	require(r.get(6)==valueInteger(4096)&&r.get(9)==valueInteger(37)&&asTable(r.get(10), m.cpu.gcHeap())->getInteger(1)==valueInteger(-1)&&isNil(r.get(8)),
		"Integer stays intact across scalar-work read and cached result is published before the unexecuted side effect");
}
#endif
} // namespace
int main(){try {pureSearchAndSeed();everyGrant();skippedLength();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	oneGateFrontier();
#endif
}catch (const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}return 0;}
