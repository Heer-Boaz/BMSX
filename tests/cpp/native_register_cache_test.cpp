#include "machine/cpu/jit/sljit/register_cache.h"
#include "machine/cpu/jit/sljit/word_constraints.h"
#include "machine/cpu/value_slots.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <new>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
constexpr NativeRegisterHost integers[]{{SLJIT_S2,true},{SLJIT_S3,true},{SLJIT_R3,false}};
#if SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS > 0
constexpr NativeRegisterHost floats[]{{SLJIT_FS0,true},{SLJIT_FR3,false}};
constexpr int savedFloats=1;
#else
constexpr NativeRegisterHost floats[]{{SLJIT_FR3,false},{SLJIT_FR4,false}};
constexpr int savedFloats=0;
#endif

struct Code {
	sljit_compiler* compiler=sljit_create_compiler(nullptr);
	void* executable=nullptr;
	explicit Code(int savedWords = 4) {
		if (!compiler) throw std::bad_alloc();
		require(sljit_emit_enter(compiler,0,SLJIT_ARGS2(32,P,P),4 | SLJIT_ENTER_FLOAT(5),
			savedWords | SLJIT_ENTER_FLOAT(savedFloats),NativeRegisterCache::capacity*sizeof(u32))==SLJIT_SUCCESS,"native cache test ABI");
	}
	~Code() { if (executable) sljit_free_code(executable,nullptr); sljit_free_compiler(compiler); }
	void result(u32 word) { sljit_emit_return(compiler,SLJIT_MOV32,SLJIT_IMM,word); }
	void finish() { executable=sljit_generate_code(compiler,0,nullptr); require(executable!=nullptr,"generate actual native cache code"); }
	u32 run(ValueSlots& slots) { return reinterpret_cast<u32 (*)(u32*,u8*)>(executable)(slots.words(),slots.tags()); }
};
void setFloatWord(sljit_compiler* compiler,sljit_s32 reg,u32 word) {
	sljit_emit_op1(compiler,SLJIT_MOV32,SLJIT_R0,0,SLJIT_IMM,word);
	sljit_emit_fcopy(compiler,SLJIT_COPY32_TO_F32,reg,SLJIT_R0);
}

void wordsFloatsAndReferences() {
	Code code;
	NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,integers,floats);
	cache.beginInstruction();
	const auto input=cache.read(0,ValueTag::Integer),sum=cache.write(0,ValueTag::Integer);
	sljit_emit_op2(code.compiler,SLJIT_ADD32,sum.reg,0,input.reg,0,SLJIT_IMM,3);
	cache.beginInstruction();
	const auto negative=cache.write(1,ValueTag::Integer);
	sljit_emit_op1(code.compiler,SLJIT_MOV32,negative.reg,0,SLJIT_IMM,-1);
	cache.beginInstruction();
	const auto source=cache.read(2,ValueTag::Float),copy=cache.write(3,ValueTag::Float);
	sljit_emit_fop1(code.compiler,SLJIT_MOV_F32,copy.reg,0,source.reg,0);
	cache.beginInstruction();
	const auto reference=cache.read(4,ValueTag::Table),referenceCopy=cache.write(5,ValueTag::Table);
	sljit_emit_op1(code.compiler,SLJIT_MOV32,referenceCopy.reg,0,reference.reg,0);
	cache.publish();code.result(0);code.finish();
	for (u32 word:{0u,0x80000000u,1u,0x007fffffu,0x00800000u,0x7f800000u,0xff800000u,0x7fa12345u,0xffa12345u,0xffc00000u}) {
		ValueSlots slots(8);slots.set(0,valueInteger(INT32_MAX));slots.set(2,valueFloatBits(word));
		slots.set(4,valueFromTag(ValueTag::Table,0xfedcba98u));slots.set(7,valueBool(true));
		require(code.run(slots)==0,"native cache returns");
		require(slots.get(0)==valueInteger(0x80000002u)&&slots.get(1)==valueInteger(-1),"Integer payloads stay exact and wrap in core registers");
		require(slots.get(2)==valueFloatBits(word)&&slots.get(3)==valueFloatBits(word),"single-lane copies retain raw signaling NaN, subnormal and zero words");
		require(slots.get(5)==slots.get(4),"reference payload is an unchanged word, not a host pointer conversion");
		require(slots.get(7)==valueBool(true),"adjacent compact tags remain untouched");
	}
}

void arithmeticAndBitMoves() {
	Code code;NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,integers,floats);
	cache.beginInstruction();const auto integer=cache.read(0,ValueTag::Integer),integerSum=cache.write(4,ValueTag::Integer);
	sljit_emit_op2(code.compiler,SLJIT_ADD32,integerSum.reg,0,integer.reg,0,SLJIT_IMM,1);
	cache.beginInstruction();const auto halfUlp=cache.read(1,ValueTag::Float),one=cache.read(2,ValueTag::Float);
	const auto rounded=cache.write(5,ValueTag::Float);
	sljit_emit_fop2(code.compiler,SLJIT_ADD_F32,rounded.reg,0,one.reg,0,halfUlp.reg,0);
	cache.beginInstruction();const auto value=cache.read(5,ValueTag::Float),bits=cache.write(8,ValueTag::Integer);
	sljit_emit_fcopy(code.compiler,SLJIT_COPY32_FROM_F32,value.reg,bits.reg);
	cache.beginInstruction();const auto raw=cache.read(9,ValueTag::Integer),decoded=cache.write(10,ValueTag::Float);
	sljit_emit_fcopy(code.compiler,SLJIT_COPY32_TO_F32,decoded.reg,raw.reg);
	cache.beginInstruction();const auto nan=cache.read(6,ValueTag::Float),negative=cache.write(7,ValueTag::Float);
	sljit_emit_fop1(code.compiler,SLJIT_NEG_F32,negative.reg,0,nan.reg,0);
	cache.publish();code.result(0);code.finish();
	ValueSlots slots(12);slots.set(0,valueInteger(16777217));slots.set(1,valueFloatBits(0x33800000));slots.set(2,valueFloat(1.0f));
	slots.set(6,valueFloatBits(0xffa12345));slots.set(9,valueInteger(0xffa12345));slots.set(11,valueBool(true));
	require(code.run(slots)==0,"native int32/f32 operations return");
	require(slots.get(4)==valueInteger(16777218),"Integer arithmetic never rounds through a float register");
	require(slots.get(5)==valueFloat(1.0f)&&slots.get(8)==valueInteger(0x3f800000),"single-precision arithmetic rounds before raw word extraction");
	require(slots.get(7)==valueFloatBits(0x7fa12345)&&slots.get(10)==valueFloatBits(0xffa12345),"negation and raw bit moves never box or canonicalize a Float payload");
	require(slots.get(11)==valueBool(true),"arithmetic retains compact plane boundaries");
}

void futureUseAndPublication() {
	Code code;NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,std::span(integers).first(2),floats);
	for(int guest=0;guest<2;++guest) {
		cache.beginInstruction();const auto input=cache.read(guest,ValueTag::Integer),output=cache.write(guest,ValueTag::Integer);
		sljit_emit_op2(code.compiler,SLJIT_ADD32,output.reg,0,input.reg,0,SLJIT_IMM,10);
	}
	cache.beginInstruction([](int guest) { return guest == 0 ? 1 : 100; });
	cache.read(2,ValueTag::Integer);
	for(int guest=0;guest<2;++guest) {
		sljit_emit_op1(code.compiler,SLJIT_MOV32,SLJIT_R0,0,SLJIT_MEM1(SLJIT_S0),guest*sizeof(u32));
		sljit_emit_op1(code.compiler,SLJIT_MOV32,SLJIT_MEM1(SLJIT_S0),(guest+4)*sizeof(u32),SLJIT_R0,0);
		sljit_emit_op1(code.compiler,SLJIT_MOV_U8,SLJIT_MEM1(SLJIT_S1),guest+4,SLJIT_IMM,static_cast<u8>(ValueTag::Integer));
	}
	cache.publishRange(0,1);
	cache.discardRange(0,1);
	cache.beginInstruction();const auto reloaded=cache.read(0,ValueTag::Integer),destination=cache.write(3,ValueTag::Integer);
	sljit_emit_op1(code.compiler,SLJIT_MOV32,destination.reg,0,reloaded.reg,0);
	cache.publish();code.result(0);code.finish();
	ValueSlots slots(7);slots.set(0,valueInteger(1));slots.set(1,valueInteger(2));slots.set(2,valueInteger(3));slots.set(6,valueBool(true));
	require(code.run(slots)==0,"farthest-use allocation returns");
	require(slots.get(4)==valueInteger(1)&&slots.get(5)==valueInteger(12),"farthest future use, not LRU, selects the dirty payload to publish");
	require(slots.get(0)==valueInteger(11)&&slots.get(3)==valueInteger(11),"range publication and invalidation reload the current word");
	require(slots.get(6)==valueBool(true),"range publication stays inside its register interval");
}

void aliasEvictionAndRetagging() {
	Code code;
	NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,std::span(integers).first(2),floats);
	cache.beginInstruction();
	const auto a=cache.read(0,ValueTag::Integer),b=cache.read(1,ValueTag::Integer);
	const auto destination=cache.write(2,ValueTag::Integer);
	sljit_emit_op2(code.compiler,SLJIT_MUL32,destination.reg,0,a.reg,0,b.reg,0);
	for (int guest=3;guest<16;++guest) {
		cache.beginInstruction();
		const auto value=cache.write(guest,guest&1?ValueTag::String:ValueTag::Integer);
		sljit_emit_op1(code.compiler,SLJIT_MOV32,value.reg,0,SLJIT_IMM,0x80000000u+guest);
	}
	// Crossing banks overwrites the old logical value rather than publishing it
	// after its replacement. The same rule applies to pending dirty tags.
	cache.beginInstruction();
	const auto changed=cache.write(15,ValueTag::Float);setFloatWord(code.compiler,changed.reg,0xffa12345u);
	cache.beginInstruction();
	const auto changedAgain=cache.write(15,ValueTag::Integer);
	sljit_emit_op1(code.compiler,SLJIT_MOV32,changedAgain.reg,0,SLJIT_IMM,17);
	cache.publish();code.result(0);code.finish();
	ValueSlots slots(18);slots.set(0,valueInteger(12345));slots.set(1,valueInteger(-2468));slots.set(17,valueFloatBits(0xffa12345));
	require(code.run(slots)==0,"full-bank native multiplication returns");
	require(slots.get(0)==valueInteger(12345)&&slots.get(1)==valueInteger(-2468),"pinned inputs remain observable after destination reuse");
	require(slots.get(2)==valueInteger(12345*-2468),"three-operand destination reuses a full bank without losing an input");
	for (int guest=3;guest<15;++guest) require(slots.get(guest)==valueFromTag(guest&1?ValueTag::String:ValueTag::Integer,0x80000000u+guest),"dirty eviction publishes both planes");
	require(slots.get(15)==valueInteger(17)&&slots.get(17)==valueFloatBits(0xffa12345),"retagging publishes only the last definition");
}

void preciseGuardSnapshots() {
	Code code;
	NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,integers,floats);
	cache.beginInstruction();const auto before=cache.read(0,ValueTag::Integer);
	const auto prefix=cache.write(0,ValueTag::Integer);
	sljit_emit_op2(code.compiler,SLJIT_ADD32,prefix.reg,0,before.reg,0,SLJIT_IMM,1);
	const auto snapshot=cache.state();
	auto same=snapshot;
	++same[0].lastUse;
	same[1].guest=3;
	same[1].tag=ValueTag::String;
	require(cache.samePublication(snapshot,same),"clean bindings and allocation history do not affect the exit");
	same[0].dirty=false;
	require(!cache.samePublication(snapshot,same),"a different payload write cannot share the exit");
	same=snapshot;
	same[0].tag=ValueTag::False;
	require(cache.samePublication(snapshot,same),"the tag of a payload-only write is not published");
	auto writesTag=snapshot;
	writesTag[0].immediateTagDirty=same[0].immediateTagDirty=true;
	require(!cache.samePublication(writesTag,same),"a different published tag cannot share the exit");
	same=snapshot;
	std::swap(same[0],same[1]);
	require(!cache.samePublication(snapshot,same),"a value moved to another host lane cannot share the exit");
	auto* miss=cache.guard(2,ValueTag::Float,SLJIT_R0);
	require(miss!=nullptr,"unknown subtype needs one admission guard");
	cache.beginInstruction();const auto after=cache.write(0,ValueTag::Integer);
	sljit_emit_op2(code.compiler,SLJIT_ADD32,after.reg,0,after.reg,0,SLJIT_IMM,10);
	cache.beginInstruction();const auto retag=cache.write(2,ValueTag::Integer);
	sljit_emit_op1(code.compiler,SLJIT_MOV32,retag.reg,0,SLJIT_IMM,23);
	require(cache.guard(2,ValueTag::Integer,SLJIT_R0)==nullptr,"proved subtype does not emit another guard");
	cache.publish();code.result(0);
	sljit_set_label(miss,sljit_emit_label(code.compiler));cache.emitState(snapshot);code.result(1);code.finish();
	for (bool fail:{false,true}) {
		ValueSlots slots(4);slots.set(0,valueInteger(7));slots.set(2,fail?valueBool(true):valueFloatBits(0xffa12345));
		require(code.run(slots)==static_cast<u32>(fail),"type admission branches before the following definition");
		require(slots.get(0)==valueInteger(fail?8:18),"cold exit materializes its exact prefix, not a later register map");
		require(slots.get(2)==(fail?valueBool(true):valueInteger(23)),"failed guard leaves the destination and subtype untouched");
	}
}

struct Clobber {
	sljit_compiler* compiler=sljit_create_compiler(nullptr);
	void* executable=nullptr;
	Clobber() {
		if (!compiler) throw std::bad_alloc();
		sljit_emit_enter(compiler,0,SLJIT_ARGS0V(),4 | SLJIT_ENTER_FLOAT(5),0,0);
		for (auto reg:{SLJIT_R0,SLJIT_R1,SLJIT_R2,SLJIT_R3}) sljit_emit_op1(compiler,SLJIT_MOV32,reg,0,SLJIT_IMM,0x12345678);
		for (auto reg:{SLJIT_FR0,SLJIT_FR1,SLJIT_FR2,SLJIT_FR3,SLJIT_FR4}) sljit_emit_fset32(compiler,reg,0.0f);
		sljit_emit_return_void(compiler);executable=sljit_generate_code(compiler,0,nullptr);
		require(executable!=nullptr,"callee-clobber code is generated");
	}
	~Clobber() { sljit_free_code(executable,nullptr);sljit_free_compiler(compiler); }
};
void selectiveCallSpills(NativeRegisterCache::FrameSlots frameSlots) {
	Clobber callee;Code code;
	NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,integers,floats);
	for (int guest=0;guest<5;++guest) {cache.beginInstruction();cache.read(guest,guest<3?ValueTag::Integer:ValueTag::Float);}
	cache.beginInstruction();
	setFloatWord(code.compiler, cache.write(4, ValueTag::Float).reg, 0x7fa12345);
	constexpr auto spillOffset = 2 * sizeof(u32);
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), spillOffset, SLJIT_IMM, 37);
	cache.spillCall(false,0,frameSlots);
	sljit_emit_icall(code.compiler,SLJIT_CALL,SLJIT_ARGS0V(),SLJIT_IMM,SLJIT_FUNC_ADDR(callee.executable));
	cache.spillCall(true,0,frameSlots);
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), spillOffset);
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S0), 5 * sizeof(u32), SLJIT_R0, 0);
	for (int guest=0;guest<5;++guest) {cache.beginInstruction();cache.write(guest,guest<3?ValueTag::Integer:ValueTag::Float);}
	cache.publish();code.result(0);code.finish();
	ValueSlots slots(7);for (int guest=0;guest<3;++guest)slots.set(guest,valueInteger(0x1234567+guest));
	slots.set(3,valueFloatBits(0xffa12345));slots.set(4,valueFloatBits(1));slots.set(5,valueInteger(0));slots.set(6,valueBool(true));
	require(code.run(slots)==0,"native code resumes after an ABI-clobbering call");
	for (int guest=0;guest<3;++guest) require(slots.get(guest)==valueInteger(0x1234567+guest),"integer caches survive selective call spills");
	require(slots.get(3)==valueFloatBits(0xffa12345)&&slots.get(4)==valueFloatBits(0x7fa12345),"callee-saved and volatile F32 lanes retain every payload bit");
	require(slots.get(5)==valueInteger(frameSlots==NativeRegisterCache::FrameSlots::Unchanged ? 37 : 0x1234569),"an unchanged frame supplies the clean payload without a stack spill");
	require(slots.get(6)==valueBool(true),"helper spill area is not guest storage");
}

void parallelTransfers() {
	std::array<int,3> permutation{0,1,2};
	do { for (bool flip:{false,true}) for (bool missing:{false,true}) {
		Code code;NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,integers,floats);
		for (int guest=0;guest<5;++guest) {
			cache.beginInstruction();const auto value=cache.write(guest,guest<3?ValueTag::Integer:ValueTag::Float);
			if (guest<3) sljit_emit_op1(code.compiler,SLJIT_MOV32,value.reg,0,SLJIT_IMM,100+guest);
			else setFloatWord(code.compiler,value.reg,0xffa12345u+guest);
		}
		const auto source=cache.state();auto target=source;
		for (int slot=0;slot<3;++slot)target[slot]=source[permutation[slot]];
		if(flip)std::swap(target[3],target[4]);
		if(missing)target[2].guest=5;
		auto* skipCold=sljit_emit_jump(code.compiler,SLJIT_JUMP);
		auto* failure=sljit_emit_label(code.compiler);cache.emitState(source);code.result(1);
		sljit_set_label(skipCold,sljit_emit_label(code.compiler));
		if (missing) sljit_set_label(cache.guard(5, ValueTag::Integer, SLJIT_R0), failure);
		cache.transferTo(target, SLJIT_R0, SLJIT_FR0);
		// Retained dirty payloads must not have gone through the memory bank.
		sljit_emit_op1(code.compiler,SLJIT_MOV32,SLJIT_R0,0,SLJIT_MEM1(SLJIT_S0),0);
		sljit_emit_op1(code.compiler,SLJIT_MOV32,SLJIT_MEM1(SLJIT_S0),7*sizeof(u32),SLJIT_R0,0);
		sljit_emit_op1(code.compiler,SLJIT_MOV_U8,SLJIT_MEM1(SLJIT_S1),7,SLJIT_IMM,static_cast<u8>(ValueTag::Integer));
		cache.publish();code.result(0);code.finish();
		for (bool fail:{false,true}) {
			ValueSlots slots(9);for(int guest=0;guest<5;++guest)slots.set(guest,valueInteger(1));
			slots.set(5,fail?valueFloat(9.0f):valueInteger(9));slots.set(8,valueBool(true));
			const bool expectedFailure=missing&&fail;
			require(code.run(slots)==static_cast<u32>(expectedFailure),"transfer admits missing tags before moving any register");
			for(int guest=0;guest<3;++guest)require(slots.get(guest)==valueInteger(100+guest),"integer cycles, retained dirty values and departed bindings are exact");
			for(int guest=3;guest<5;++guest)require(slots.get(guest)==valueFloatBits(0xffa12345u+guest),"Float permutation retains raw words");
			if(!expectedFailure)require(slots.get(7)==valueInteger(missing&&permutation[2]==0?100:1),"retained dirty payloads bypass guest memory during register transfer");
			require(slots.get(8)==valueBool(true),"parallel transfer writes only its guest bindings");
		}
	} }while(std::next_permutation(permutation.begin(),permutation.end()));
}

void untypedTransfersPublishTagsButKeepPayloads() {
	Code code;
	NativeRegisterCache cache(code.compiler, SLJIT_S0, SLJIT_S1, std::span(integers).first(1), std::span(floats).first(1));
	const auto word = cache.write(0, ValueTag::Integer);
	const auto fp = cache.write(1, ValueTag::Float);
	sljit_emit_op1(code.compiler, SLJIT_MOV32, word.reg, 0, SLJIT_IMM, 0x12345678);
	setFloatWord(code.compiler, fp.reg, 0xffa12345u);

	auto target = cache.state();
	std::swap(target[0], target[1]);
	for (auto& binding : std::span(target).first(2)) {
		binding.tag.reset();
		binding.immediateTagDirty = false;
	}
	cache.transferTo(target, SLJIT_R0, SLJIT_FR0);

	// The edge published the tags but neither payload has roundtripped.
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S0), 0);
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S0), 2 * sizeof(u32), SLJIT_R0, 0);
	cache.emitTag(0, SLJIT_R0);
	sljit_emit_op1(code.compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_S1), 2, SLJIT_R0, 0);
	cache.publish();
	code.result(0);
	code.finish();

	ValueSlots slots(3);
	slots.set(0, valueInteger(19));
	slots.set(1, valueBool(false));
	require(code.run(slots) == 0 && slots.get(0) == valueInteger(0x12345678)
		&& slots.get(1) == valueFloatBits(0xffa12345u) && slots.get(2) == valueInteger(19),
		"raw permutations left tags authoritative in memory while carrying both payloads across banks");
}

void dynamicValueAcrossEdge() {
	Code code;
	NativeRegisterCache cache(code.compiler, SLJIT_S0, SLJIT_S1, integers, floats);
	const auto result = cache.writeRaw(1, NativeOperandDemand::Value);
	cache.emitWord(0, result.word);
	cache.emitTag(0, result.tag);
	auto target = cache.state();
	std::swap(target[0], target[1]); // Parallel copy exchanges payload and tag.
	cache.transferTo(target, SLJIT_R0, SLJIT_FR0);
	// Observe the backing planes before either the guard exit or normal publication.
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S0), sizeof(u32));
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S0), 2 * sizeof(u32), SLJIT_R0, 0);
	sljit_emit_op1(code.compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S1), 1);
	sljit_emit_op1(code.compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_S1), 2, SLJIT_R1, 0);
	const auto snapshot = cache.state();
	auto* rejected = cache.guard(1, ValueTag::Float, SLJIT_R0);
	cache.beginInstruction();
	cache.read(1, ValueTag::Float);
	cache.publish();
	code.result(0);
	sljit_set_label(rejected, sljit_emit_label(code.compiler));
	cache.emitState(snapshot);
	code.result(1);
	code.finish();
	for (Value value : {valueFloatBits(0xffa12345u), valueInteger(0xf1234567u), valueBool(true)}) {
		ValueSlots slots(3);
		slots.set(0, value);
		slots.set(1, valueBool(false));
		require(code.run(slots) == (valueTag(value) != ValueTag::Float), "guard follows the transferred tag");
		require(slots.get(1) == value && slots.get(2) == valueBool(false),
			"both planes bypass stale guest storage and publish exactly on the selected exit");
	}
}

void payloadUseWithPublishedTag() {
	Code code;
	NativeRegisterCache cache(code.compiler, SLJIT_S0, SLJIT_S1, std::span(integers).first(1), floats);
	const auto result = cache.writeRaw(1, NativeOperandDemand::Payload);
	cache.emitWord(0, result.word);
	cache.emitTag(0, SLJIT_R0);
	sljit_emit_op1(code.compiler, SLJIT_MOV_U8, result.tag, result.tagOffset, SLJIT_R0, 0);
	const auto snapshot = cache.state();
	auto* miss = cache.guard(1, ValueTag::Float, SLJIT_R0);
	cache.beginInstruction();
	cache.read(1, ValueTag::Float);
	cache.publish();
	code.result(0);
	sljit_set_label(miss, sljit_emit_label(code.compiler));
	cache.emitState(snapshot);
	code.result(1);
	code.finish();
	for (Value input : {valueInteger(-7), valueFloatBits(0xffa12345u)}) {
		ValueSlots slots(2);
		slots.set(0, input);
		slots.set(1, valueBool(true));
		require(code.run(slots) == (valueTag(input) != ValueTag::Float) && slots.get(1) == input,
			"a single payload register and the published tag reconstruct the value on both edges");
	}
}

void tagUseWithRecoverableWord() {
	Code code;
	NativeRegisterCache cache(code.compiler, SLJIT_S0, SLJIT_S1, std::span(integers).first(1), floats);
	const auto result = cache.writeRaw(1, NativeOperandDemand::Tag);
	cache.emitWord(0, SLJIT_R0);
	sljit_emit_op1(code.compiler, SLJIT_MOV32, result.word, result.wordOffset, SLJIT_R0, 0);
	cache.emitTag(0, result.tag);
	const auto snapshot = cache.state();
	auto* miss = cache.guard(1, ValueTag::Nil, SLJIT_R0);
	cache.publish();
	code.result(0);
	sljit_set_label(miss, sljit_emit_label(code.compiler));
	cache.emitState(snapshot);
	code.result(1);
	code.finish();
	for (Value input : {valueNil(), valueInteger(-7), valueFloatBits(0xffa12345u)}) {
		ValueSlots slots(2);
		slots.set(0, input);
		slots.set(1, valueBool(true));
		require(code.run(slots) == (input != valueNil()) && slots.get(1) == input,
			"one available word register suffices for a nil comparison and exact recovery on either exit");
	}
}

void sharedWordsSurviveTemporaryUse() {
#if SLJIT_NUMBER_OF_SAVED_REGISTERS >= 6 && SLJIT_NUMBER_OF_REGISTERS >= 10
	Code code(6);
	constexpr NativeRegisterHost bank[]{{SLJIT_S2,true},{SLJIT_S3,true},{SLJIT_S4,true},{SLJIT_S5,true},
		{SLJIT_R0,false},{SLJIT_R1,false},{SLJIT_R2,false},{SLJIT_R3,false}};
	NativeRegisterCache cache(code.compiler, SLJIT_S0, SLJIT_S1, bank, floats);
	// R0 is needed by the following Float literal; R1 remains available.
	const std::array rows{NativeInstruction(NativeLiteral{4, valueInteger(104)}),
		NativeInstruction(NativeLiteral{8, valueFloat(0.5f)}), NativeInstruction(NativeHalt{})};
	std::array<NativeWordConstraints, 3> constraints;
	planWordConstraints(rows, constraints);
	cache.applyConstraints(constraints[0]);
	for (int i = 0; i < 8; ++i) {
		cache.beginInstruction();
		const auto value = cache.write(i, ValueTag::Integer);
		const int location = i < 4 ? i : i == 7 ? 4 : i + 1;
		require(value.reg == bank[location].reg, "the shared register needed soonest is assigned last");
		sljit_emit_op1(code.compiler, SLJIT_MOV32, value.reg, 0, SLJIT_IMM, 100 + i);
	}
	cache.beginInstruction([](int guest) { return guest == 3 ? 100 : guest == 7 ? 20 : 1; });
	cache.reserveScratch(1u << 2);
	require(cache.state()[3].guest == 5 && !cache.binding(3),
		"a fixed conflict preserves the earlier read even with no empty GPR");
	const auto temporary = cache.acquireScratch();
	require(temporary == SLJIT_R0 && cache.binding(4) && cache.binding(6),
		"the address temporary takes the distant use, not another still-live fixed or shared operand");
	for (auto reg : {temporary, SLJIT_R2})
		sljit_emit_op1(code.compiler, SLJIT_MOV32, reg, 0, SLJIT_IMM, 0xdead);
	cache.reserveScratch(0);
	cache.beginInstruction();
	const auto a = cache.read(7, ValueTag::Integer);
	const auto b = cache.read(5, ValueTag::Integer);
	const auto sum = cache.write(0, ValueTag::Integer);
	sljit_emit_op2(code.compiler, SLJIT_ADD32, sum.reg, 0, a.reg, 0, b.reg, 0);
	cache.publishRange(1, 2);
	cache.discardRange(1, 2); // S3 becomes available for the dirty R1 value.
	cache.beginInstruction();
	cache.reserveScratch(1u << 1);
	require(cache.state()[1].guest == 4 && cache.state()[1].dirty,
		"a fixed use renames the still-unpublished value into a free register");
	sljit_emit_op1(code.compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0xbeef);
	cache.publish();
	code.result(0);
	code.finish();
	ValueSlots slots(8);
	require(code.run(slots) == 0 && slots.get(0) == valueInteger(212), "clobbered shared inputs reload their own values");
	for (int i = 1; i < 8; ++i)
		require(slots.get(i) == valueInteger(100 + i), "the final exit reconstructs every shared and saved value");
#endif
}

void loopEdges() {
	Code code;NativeRegisterCache cache(code.compiler,SLJIT_S0,SLJIT_S1,std::span(integers).first(2),floats);
	cache.beginInstruction();cache.read(0,ValueTag::Integer);cache.read(1,ValueTag::Integer);
	cache.write(0,ValueTag::Integer);cache.write(1,ValueTag::Integer);
	const auto entry=cache.state();
	auto* loop=sljit_emit_label(code.compiler);
	cache.beginInstruction();const auto counter=cache.read(0,ValueTag::Integer),sum=cache.read(1,ValueTag::Integer);
	const auto output=cache.write(1,ValueTag::Integer);
	sljit_emit_op2(code.compiler,SLJIT_ADD32,output.reg,0,sum.reg,0,counter.reg,0);
	const auto decremented=cache.write(0,ValueTag::Integer);
	sljit_emit_op2(code.compiler,SLJIT_SUB32,decremented.reg,0,counter.reg,0,SLJIT_IMM,1);
	auto swapped = cache.state();
	std::swap(swapped[0], swapped[1]);
	cache.transferTo(swapped, SLJIT_R0, SLJIT_FR0);
	cache.beginInstruction();const auto condition=cache.read(0,ValueTag::Integer);
	auto* taken=sljit_emit_cmp(code.compiler,SLJIT_SIG_GREATER | SLJIT_32,condition.reg,0,SLJIT_IMM,0);
	const auto backedge=cache.state();cache.publish();code.result(0);
	sljit_set_label(taken,sljit_emit_label(code.compiler));cache.setState(backedge);
	cache.transferTo(entry, SLJIT_R0, SLJIT_FR0);
	sljit_set_label(sljit_emit_jump(code.compiler,SLJIT_JUMP),loop);
	code.finish();
	for (int count:{1,2,3,17,1000}) {
		ValueSlots slots(3);slots.set(0,valueInteger(count));slots.set(1,valueInteger(0));slots.set(2,valueBool(true));
		require(code.run(slots)==0,"native Integer loop returns through typed branch maps");
		require(slots.get(0)==valueInteger(0)&&slots.get(1)==valueInteger(count*(count+1)/2),"loop-carried unboxed payloads survive both permutations");
		require(slots.get(2)==valueBool(true),"loop does not touch neighboring guest slots");
	}
}
}

int main() {
	try {
		wordsFloatsAndReferences();arithmeticAndBitMoves();futureUseAndPublication();
		aliasEvictionAndRetagging();preciseGuardSnapshots();
		selectiveCallSpills(NativeRegisterCache::FrameSlots::MayChange);
		selectiveCallSpills(NativeRegisterCache::FrameSlots::Unchanged);parallelTransfers();untypedTransfersPublishTagsButKeepPayloads();dynamicValueAcrossEdge();payloadUseWithPublishedTag();tagUseWithRecoverableWord();sharedWordsSurviveTemporaryUse();loopEdges();
		std::cout<<"Native word/F32 cache, precise exits, selective spills and typed loop transfers passed\n";
		return 0;
	} catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
