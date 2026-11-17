#include "machine/cpu/cpu.h"
#include "machine/cpu/value_arithmetic.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include <iostream>
#include <iterator>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool condition, const char* text) { if (!condition) throw std::runtime_error(text); }
struct Machine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	Machine(test::Blua32TestImage image)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image)),
		memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) { cpu.reset(); }
};
test::Blua32TestImage operation(OpCode op) {
	test::Blua32TestImage image;
	if (op == OpCode::EQ || op == OpCode::LT || op == OpCode::LE) {
		image.text.resize(7 * INSTRUCTION_BYTES);
		writeInstruction(image.text,0,static_cast<u8>(op),1,0,1);
		writeInstruction(image.text,1,static_cast<u8>(OpCode::JMP),0,0,2);
		writeInstruction(image.text,2,static_cast<u8>(OpCode::KFALSE),2,0,0);
		writeInstruction(image.text,3,static_cast<u8>(OpCode::JMP),0,0,1);
		writeInstruction(image.text,4,static_cast<u8>(OpCode::KTRUE),2,0,0);
		writeInstruction(image.text,5,static_cast<u8>(OpCode::RET),2,2,0);
		writeInstruction(image.text,6,static_cast<u8>(OpCode::HALT),0,0,0);
		image.functions={{.firstWord=0,.wordCount=6,.numParams=3,.maxStack=8},{.firstWord=6,.wordCount=1,.maxStack=8}};
		image.exceptionFunctionIndex=1; return image;
	}
	image.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(op), 2, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::RET), 2, 2, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord=0, .wordCount=2, .numParams=3, .maxStack=8}, {.firstWord=2, .wordCount=1, .maxStack=8}};
	image.exceptionFunctionIndex = 1;
	return image;
}
Value calculate(OpCode op, Value a, Value b) {
	switch(op) {
		case OpCode::ADD: return valueAdd(a,b); case OpCode::SUB: return valueSubtract(a,b);
		case OpCode::MUL: return valueMultiply(a,b); case OpCode::DIV: return valueDivide(a,b);
		case OpCode::MOD: return valueModulo(a,b); case OpCode::FLOORDIV: return valueFloorDivide(a,b);
		case OpCode::POW: return valuePower(a,b);
		case OpCode::BAND: return valueInteger(integerOperand(a)&integerOperand(b));
		case OpCode::BOR: return valueInteger(integerOperand(a)|integerOperand(b));
		case OpCode::BXOR: return valueInteger(integerOperand(a)^integerOperand(b));
		case OpCode::SHL: return valueInteger(luaShiftLeft(integerOperand(a),integerOperand(b)));
		case OpCode::SHR: return valueInteger(luaShiftRight(integerOperand(a),integerOperand(b)));
		default: throw std::runtime_error("test operation");
	}
}
void scalarNumbers() {
	const Value values[] = {valueInteger(0),valueInteger(1),valueInteger(-1),valueInteger(INT32_MIN),valueInteger(INT32_MAX),valueInteger(16777217),valueFloat(16777216.0f),valueFloat(-2.5f),valueFloatBits(1),valueFloatBits(0x80000000),valueFloatBits(0x7f800000),valueFloatBits(0xff800000),valueFloatBits(0x7fa12345)};
	for (OpCode op: {OpCode::ADD,OpCode::SUB,OpCode::MUL,OpCode::DIV,OpCode::MOD,OpCode::FLOORDIV,OpCode::POW,OpCode::BAND,OpCode::BOR,OpCode::BXOR,OpCode::SHL,OpCode::SHR}) {
		Machine m(operation(op));
		Closure* closure = m.cpu.activeThread()->currentFrame->closure;
		bool first = true;
		for (Value a:values) for (Value b:values) {
			Value expected;
			try { expected = calculate(op,a,b); } catch(const LuaExecutionError&) { continue; }
			if (!first) m.cpu.beginCompletionCall(*closure);
			first=false;
			auto registers = m.cpu.activeThread()->currentFrame->registers;
			registers.set(0,a); registers.set(1,b); registers.set(2,valueInteger(917));
			require(m.cpu.runUntilDepth(0,1000)==RunResult::Halted,"numeric function returns");
			const auto result=m.cpu.readCompletionValues();
			require(result.size()==1 && result.get(0)==expected,"CPU opcode retains the numeric subtype and exact word");
		}
	}
	for (Value bad:{valueNil(),valueBool(true),valueString(0)}) {
		Machine m(operation(OpCode::ADD)); auto registers=m.cpu.activeThread()->currentFrame->registers;
		registers.set(0,bad); registers.set(1,valueInteger(1)); registers.set(2,valueInteger(917));
		m.cpu.runUntilDepth(0,BASE_CYCLES[static_cast<u8>(OpCode::ADD)]);
		require(m.cpu.readLuaFaultReasonWord()==LUA_FAULT_REASON_INVALID_ARGUMENT,"non-Numbers take the guest operand fault");
		require(m.cpu.readFrameRegister(0,2)==valueInteger(917),"failed arithmetic leaves destination intact");
	}
}
void unaryAndCompare() {
	for (auto op:{OpCode::UNM,OpCode::BNOT}) for (Value value:{valueInteger(INT32_MIN),valueInteger(1),valueFloatBits(0x7fa12345),valueFloatBits(0xffc00000),valueFloatBits(0x80000000)}) {
		if (op==OpCode::BNOT && !valueIsInteger(value)) continue;
		Machine m(operation(op)); m.cpu.activeThread()->currentFrame->registers.set(0,value);
		m.cpu.runUntilDepth(0,100);
		const auto expected=op==OpCode::UNM?valueNegate(value):valueInteger(~asInteger(value));
		require(m.cpu.readCompletionValues().get(0)==expected,"unary operations preserve subtype and raw negated NaN payloads");
	}
	const Value values[]={valueInteger(16777217),valueFloat(16777216.0f),valueInteger(INT32_MAX),valueFloatBits(0x4f000000),valueFloatBits(0x7fa12345),valueFloatBits(0x80000000),valueInteger(0),valueFromTag(ValueTag::True,1),valueFromTag(ValueTag::True,2),valueNil()};
	for(auto op:{OpCode::EQ,OpCode::LT,OpCode::LE}) {
		Machine m(operation(op)); auto* closure=m.cpu.activeThread()->currentFrame->closure; bool first=true;
		for(Value a:values) for(Value b:values) {
			if (!first) m.cpu.beginCompletionCall(*closure);
			first = false;
			auto regs=m.cpu.activeThread()->currentFrame->registers; regs.set(0,a);regs.set(1,b);
			m.cpu.runUntilDepth(0,100);
			const bool both=valueIsNumber(a)&&valueIsNumber(b);
			const bool expected=op==OpCode::EQ?valuesEqual(a,b):both&&(op==OpCode::LT?compareNumbers(a,b)==NumericOrder::Less:static_cast<int>(compareNumbers(a,b))<=0);
			require(m.cpu.readCompletionValues().get(0)==valueBool(expected),"mixed comparisons use exact Integer values and their 32-bit skip/jump continuations");
		}
	}
}
void memoryWords() {
	for(auto kind:{MemoryAccessKind::Word,MemoryAccessKind::U32LE,MemoryAccessKind::F32LE,MemoryAccessKind::F64LE}) {
		auto image=operation(OpCode::LOAD_MEM); writeInstruction(image.text,0,static_cast<u8>(OpCode::LOAD_MEM),2,0,static_cast<u8>(kind));
		Machine m(image); const u32 address=DYNAMIC_RAM_BASE+0x200;
		m.memory.writeMappedU32LE(address,kind==MemoryAccessKind::F32LE?0xffa12345u:0xffffffffu);
		if(kind==MemoryAccessKind::F64LE)m.memory.writeMappedF64LE(address,16777217.0);
		m.cpu.activeThread()->currentFrame->registers.set(0,valueInteger(address));
		m.cpu.runUntilDepth(0,1);
		const Value expected=kind==MemoryAccessKind::F32LE?valueFloatBits(0xffa12345u):kind==MemoryAccessKind::F64LE?valueFloat(16777216.0f):valueInteger(-1);
		require(m.cpu.readFrameRegister(0,2)==expected,"scalar load produces a signed word or raw/rounded Float as specified");
		require(m.cpu.instructionBudgetRemaining==1-BASE_CYCLES[static_cast<u8>(OpCode::LOAD_MEM)]-(kind==MemoryAccessKind::F64LE?2:0),"F64 second-word transfer is charged exactly once");
	}
	for(auto kind:{MemoryAccessKind::Word,MemoryAccessKind::F32LE,MemoryAccessKind::F64LE}) {
		auto image=operation(OpCode::STORE_MEM);writeInstruction(image.text,0,static_cast<u8>(OpCode::STORE_MEM),2,0,static_cast<u8>(kind));
		Machine m(image);const u32 address=DYNAMIC_RAM_BASE+0x300;
		auto regs=m.cpu.activeThread()->currentFrame->registers;regs.set(0,valueInteger(address));regs.set(2,kind==MemoryAccessKind::F32LE?valueFloatBits(0xffa12345):valueInteger(-1));
		m.cpu.runUntilDepth(0,1);
		if(kind==MemoryAccessKind::F64LE)require(m.memory.readMappedF64LE(address)==-1.0,"external binary64 encoding widens Integer exactly");
		else require(m.memory.readMappedU32LE(address)==(kind==MemoryAccessKind::F32LE?0xffa12345u:0xffffffffu),"word/F32 store preserves all bits");
	}
	for(auto op:{OpCode::LOAD_MEM,OpCode::STORE_MEM}) {
		auto image=operation(op);writeInstruction(image.text,0,static_cast<u8>(op),2,0,static_cast<u8>(MemoryAccessKind::F64LE));
		Machine m(image);m.cpu.activeThread()->currentFrame->registers.set(0,valueInteger(DYNAMIC_RAM_BASE+1));m.cpu.runUntilDepth(0,1);
		require(m.cpu.instructionBudgetRemaining==-4,"even alignment faults retain the started F64 format charge");
	}
}

test::Blua32TestImage constantImage() {
	auto image=operation(OpCode::LOADK);
	writeInstruction(image.text,0,static_cast<u8>(OpCode::LOADK),2,0,1);
	image.constants={i32{2},Blua32FloatConstant{0xffa12345}};
	image.globalNames={"saved", "graph"}; image.systemGlobalNames={"system"};
	return image;
}
test::Blua32TestImage regionImage(const std::string& name) {
	struct Instruction { OpCode op; u8 a,b,c,ext=0; };
	std::vector<Instruction> program;
	if(name=="chain") program={{OpCode::MOV,8,0,0},{OpCode::ADD,2,0,1},{OpCode::SHL,3,2,4},{OpCode::BXOR,2,3,5},
		{OpCode::UNM,3,2,0},{OpCode::MUL,2,3,1},{OpCode::DIV,3,2,1},{OpCode::UNM,3,3,0},
		{OpCode::SETGL,3,0,0},{OpCode::GETGL,4,0,0},{OpCode::RET,2,4,0}};
	else if(name=="table") program={{OpCode::MOV,8,0,0},{OpCode::SETI,8,1,1},{OpCode::GETI,2,8,1},
		{OpCode::SETFIELD,8,0,2},{OpCode::GETFIELD,3,8,0},{OpCode::SELF,4,8,0},
		{OpCode::GETT,6,8,7},{OpCode::LEN,9,8,0},{OpCode::RET,2,9,0}};
	else if(name=="upvalue") program={{OpCode::MOV,8,0,0},{OpCode::GETUP,20,0,0},{OpCode::MOV,21,20,0},
		{OpCode::SETUP,1,0,0},{OpCode::GETUP,22,0,0},{OpCode::RET,20,4,0}};
	else if(name=="words") program={{OpCode::MOV,8,0,0},{OpCode::STORE_MEM_WORDS,1,8,3},{OpCode::RET,1,4,0}};
	else if(name=="control") program={{OpCode::MTC0,0,COP0_EPC,0},{OpCode::MFC0,2,COP0_EPC,0},
		{OpCode::LOADKR,3,1,0},{OpCode::RET,2,3,0}};
	else if(name=="loop") program={{OpCode::MOV,8,0,0},{OpCode::ADD,2,2,1},{OpCode::SUB,0,0,1},
		{OpCode::LE,0,0,3},{OpCode::JMP,0,63,60,255},{OpCode::RET,2,2,0}};
	else if(name=="memory") program={{OpCode::LOAD_MEM,2,0,static_cast<u32>(MemoryAccessKind::F64LE)},
		{OpCode::MOV,6,2,0},{OpCode::STORE_MEM,2,1,static_cast<u32>(MemoryAccessKind::F64LE)},
		{OpCode::LOAD_MEM,3,1,static_cast<u32>(MemoryAccessKind::F32LE)},{OpCode::RET,2,6,0}};
	else throw std::runtime_error("unknown CPU32 region fixture");
	test::Blua32TestImage image; image.text.resize((program.size()+1)*INSTRUCTION_BYTES);
	for(u32 i=0;i<program.size();++i)writeInstruction(image.text,i,static_cast<u8>(program[i].op),program[i].a,program[i].b,program[i].c,program[i].ext);
	writeInstruction(image.text,static_cast<u32>(program.size()),static_cast<u8>(OpCode::HALT),0,0,0);
	image.functions={{.firstWord=0,.wordCount=static_cast<u32>(program.size()),.numParams=8,.maxStack=24},
		{.firstWord=static_cast<u32>(program.size()),.wordCount=1,.maxStack=8}};
	image.exceptionFunctionIndex=1;image.constants={std::string("field")};image.globalNames={"saved"};return image;
}
void scalarRegions() {
	for(const char* name:{"chain","memory","table","words","control","loop"}) {
		Machine m(regionImage(name));auto r=m.cpu.activeThread()->currentFrame->registers;
		r.set(0,valueInteger(3));r.set(1,valueInteger(2));r.set(2,valueInteger(0));r.set(3,valueInteger(0));r.set(4,valueInteger(1));r.set(5,valueInteger(7));
		if(std::string(name)=="memory") {
			r.set(0,valueInteger(DYNAMIC_RAM_BASE+0x100));r.set(1,valueInteger(DYNAMIC_RAM_BASE+0x200));
			m.memory.writeMappedF64LE(DYNAMIC_RAM_BASE+0x100,16777217.0);
		} else if(std::string(name)=="table") {
			auto* table=m.cpu.createTable(1,1);r.set(0,valueTable(m.cpu.gcHeap().reference(table)));r.set(7,valueFloat(1));
		} else if(std::string(name)=="words") r.set(0,valueInteger(DYNAMIC_RAM_BASE+0x200));
		else if(std::string(name)=="control") {r.set(0,valueInteger(INT32_MIN));r.set(1,valueFloat(0));}
		else if(std::string(name)=="loop") r.set(1,valueInteger(1));
		m.cpu.runUntilDepth(0,1000);auto results=m.cpu.readCompletionValues();
		if(std::string(name)=="chain") require(results.size()==3&&results.get(0)==valueInteger(-26)&&results.get(1)==valueFloat(13)&&results.get(2)==valueFloat(13),"typed arithmetic/globals chain");
		if(std::string(name)=="table") require(results.size()==8&&results.get(0)==valueInteger(2)&&results.get(1)==valueInteger(2)&&results.get(7)==valueInteger(1),"Table opcode chain");
		if(std::string(name)=="memory") require(results.get(0)==valueFloat(16777216)&&m.memory.readMappedF64LE(DYNAMIC_RAM_BASE+0x200)==16777216.0,"external F64 transfer chain");
		if(std::string(name)=="words") require(m.memory.readMappedU32LE(DYNAMIC_RAM_BASE+0x200)==2,"counted word stores");
		if(std::string(name)=="control") require(results.get(0)==valueInteger(INT32_MIN)&&valueIsString(results.get(1)),"control words and indirect constant index");
		if(std::string(name)=="loop") require(results.get(0)==valueInteger(3),"word-addressed backward jump");
	}
}
void constantsGlobalsAndRestore() {
	auto image=constantImage();
	Machine m(image);
	m.cpu.setGlobalByKey(*m.cpu.stringPool().find("saved"),valueFloatBits(0xffa54321));
	m.cpu.setSystemGlobalByKey(*m.cpu.stringPool().find("system"),valueInteger(INT32_MIN));
	auto* graph=m.cpu.createTable(), *child=m.cpu.createTable();
	const auto self=m.cpu.stringPool().intern("self"), childKey=m.cpu.stringPool().intern("child");
	graph->setStringKey(self,valueTable(m.cpu.gcHeap().reference(graph)));
	graph->setStringKey(childKey,valueTable(m.cpu.gcHeap().reference(child))); child->metatable=graph;
	m.cpu.setGlobalByKey(*m.cpu.stringPool().find("graph"),valueTable(m.cpu.gcHeap().reference(graph)));
	const auto graphHash=graph->hashId, childHash=child->hashId;
	m.cpu.runUntilDepth(0,1); // Stop after LOADK; retain the real active register graph.
	require(m.cpu.readFrameRegister(0,2)==valueFloatBits(0xffa12345),"Float constant preserves signaling NaN bits");
	const auto state=m.cpu.captureRuntimeState();
	m.cpu.activeThread()->currentFrame->registers.set(2,valueInteger(8));
	m.cpu.setGlobalByKey(*m.cpu.stringPool().find("saved"),valueInteger(7));
	for(int i=0;i<10;++i)m.cpu.createTable();
	m.cpu.restoreRuntimeState(state);
	require(m.cpu.readFrameRegister(0,2)==valueFloatBits(0xffa12345),"frame restore preserves raw Float word");
	require(m.cpu.getGlobalByKey(*m.cpu.stringPool().find("saved"))==valueFloatBits(0xffa54321),"compact global restore preserves raw Float word");
	require(m.cpu.getSystemGlobalByKey(*m.cpu.stringPool().find("system"))==valueInteger(INT32_MIN),"system globals retain signed Integer identity");
	auto* restored=asTable(m.cpu.getGlobalByKey(*m.cpu.stringPool().find("graph")),m.cpu.gcHeap());
	auto* restoredChild=asTable(restored->getStringKey(childKey),m.cpu.gcHeap());
	require(restored->hashId==graphHash && restoredChild->hashId==childHash,"heap restore preserves hash identities independently of payload ids");
	require(asTable(restored->getStringKey(self),m.cpu.gcHeap())==restored && restoredChild->metatable==restored,"restore remaps cyclic Table and metatable edges");
	m.cpu.runUntilDepth(0,100); require(m.cpu.readCompletionValues().get(0)==valueFloatBits(0xffa12345),"restored function returns exact words");
}
void tableHeap() {
	Memory memory(MemoryInit{},PSX_MACHINE_SPEC.ramBytes); IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory,irq,addresses);
	auto* table=cpu.createTable(),*child=cpu.createTable();
	const Value root=valueTable(cpu.gcHeap().reference(table)), key=valueTable(cpu.gcHeap().reference(child));
	table->set(key,valueFloatBits(0xffa12345)); table->set(valueFloat(2.0f),valueInteger(9));
	for (i32 i=1;i<=512;++i) table->setStringKey(cpu.stringPool().intern("field"+std::to_string(i)),valueInteger(i));
	cpu.collectHeap(root);
	require(table->get(key)==valueFloatBits(0xffa12345),"compact Table traces raw heap references");
	require(table->getInteger(2)==valueInteger(9),"integral Float key normalizes into array");
	for(i32 i=1;i<=512;++i) require(table->getStringKey(*cpu.stringPool().find("field"+std::to_string(i)))==valueInteger(i),"compact hash growth retains entries");
}
}
int main(int argc, char** argv) {
	if((argc==2 || ((argc==3 || argc==4) && std::string(argv[2])=="--boot-primitives")) && std::string(argv[1])=="--execute-rom") {
		const std::vector<u8> bytes(std::istreambuf_iterator<char>(std::cin),{});
		Memory memory(MemoryInit{bytes,test::cartridgeSlots()},PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);ExecutionAddressSpace addresses(memory);CPU cpu(memory,irq,addresses);cpu.reset();
		if (argc >= 3) cpu.installBootPrimitives();
		cpu.runUntilDepth(0, argc == 4 ? std::stoi(argv[3]) : 100000);auto results=cpu.readCompletionValues();
		std::cout<<"budget "<<cpu.instructionBudgetRemaining<<" fault "<<cpu.readLuaFaultReasonWord()<<"\n";
		for(size_t i=0;i<results.size();++i) {
			const auto value=results.get(i);
			if(valueIsString(value))std::cout<<"S "<<cpu.stringPool().toString(asStringId(value))<<"\n";
			else std::cout<<std::hex<<static_cast<unsigned>(valueTag(value))<<' '<<valuePayload(value)<<"\n";
		}
		return 0;
	}
	if ((argc == 3 || argc == 4) && std::string(argv[1]) == "--rom") {
		auto image=operation(static_cast<OpCode>(std::stoul(argv[2])));
		if(argc==4)writeInstruction(image.text,0,static_cast<u8>(std::stoul(argv[2])),2,0,static_cast<u8>(std::stoul(argv[3])));
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System,image);
		std::cout.write(reinterpret_cast<const char*>(rom.bytes.data()), rom.bytes.size()); return 0;
	}
	if (argc == 3 && std::string(argv[1]) == "--rom-region") {
		const auto rom=test::encodeBlua32TestRom(RomImageDomain::System,regionImage(argv[2]));
		std::cout.write(reinterpret_cast<const char*>(rom.bytes.data()),rom.bytes.size());return 0;
	}
	if (argc == 2 && std::string(argv[1]) == "--rom-constants") {
		const auto rom=test::encodeBlua32TestRom(RomImageDomain::System,constantImage());
		std::cout.write(reinterpret_cast<const char*>(rom.bytes.data()),rom.bytes.size());return 0;
	}
	try { scalarNumbers(); unaryAndCompare(); memoryWords(); scalarRegions(); constantsGlobalsAndRestore(); tableHeap(); std::cout<<"CPU32 scalar, compact roots, snapshots and Table tests passed\n"; return 0; }
	catch(const std::exception& e) {std::cerr<<e.what()<<'\n';return 1;}
}
