#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/cpu/table.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/builtin.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class Input final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

struct Fixture {
	test::Blua32TestRom rom;
	Input input;
	Runtime runtime;

	Fixture(const test::Blua32TestImage& image, bool scalar, bool prepare = true)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image)),
		  runtime({rom.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input) {
		runtime.boot();
		if (scalar) runtime.machine.cpu.setExecutionHook({
			[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		else if (prepare) {
			runtime.machine.cpu.prepareSystemNativeCode();
			const auto* frame = runtime.machine.cpu.rootThread()->frameAtDepth(0);
			const auto& pages = frame->executionImage->decodedPages;
			const auto page = pages.find(rom.textAddress & ~MAPPED_PAGE_BYTE_MASK);
			require(page != pages.end() && page->second.nativeBlocks
				&& page->second.nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
				"the diagnostic native case must execute an actually published native entry");
		}
#else
		(void)prepare;
#endif
	}

	CallFrame& frame() { return *runtime.machine.cpu.activeThread()->frameAtDepth(0); }
	void restart() {
		runtime.machine.cpu.clearHaltUntilIrq();
		runtime.machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
	}
};

struct Run {
	RunResult result;
	int consumed;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	i64 nativeCycles;
	DiagnosticOpcodeCounts native;
	DiagnosticOpcodeCounts interpreter;
#endif
};

#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
DiagnosticOpcodeCounts difference(const DiagnosticOpcodeCounts& end, const DiagnosticOpcodeCounts& begin) {
	return {end.newt-begin.newt, end.call-begin.call, end.setfield-begin.setfield,
		end.concat-begin.concat, end.concatn-begin.concatn};
}
void requireCounts(const DiagnosticOpcodeCounts& actual, DiagnosticOpcodeCounts expected, const char* message) {
	require(actual.newt == expected.newt && actual.call == expected.call && actual.setfield == expected.setfield
		&& actual.concat == expected.concat && actual.concatn == expected.concatn, message);
}
DiagnosticOpcodeCounts total(const Run& run) {
	return {run.native.newt+run.interpreter.newt, run.native.call+run.interpreter.call,
		run.native.setfield+run.interpreter.setfield, run.native.concat+run.interpreter.concat,
		run.native.concatn+run.interpreter.concatn};
}
#endif

Run run(Fixture& fixture, int grant) {
	auto& machine = fixture.runtime.machine;
	auto& cpu = machine.cpu;
	auto& scheduler = machine.scheduler;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto before = cpu.diagnosticExecutionProfile();
	const auto consumedBefore = scheduler.diagnosticCpuSliceConsumedCycles;
	const auto nativeBefore = scheduler.diagnosticNativeOriginCycles;
	const auto interpreterBefore = scheduler.diagnosticInterpreterRuntimeCycles;
	const auto nativeOpsBefore = scheduler.diagnosticNativeOpcodes;
	const auto interpreterOpsBefore = scheduler.diagnosticInterpreterOpcodes;
#endif
	const auto result = scheduler.runCpuSlice(0, grant);
	const int consumed = grant - cpu.instructionBudgetRemaining;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto& after = cpu.diagnosticExecutionProfile();
	const i64 native = after.nativeOriginCycles - before.nativeOriginCycles;
	require(native >= 0 && native <= consumed, "native-origin cycles partition the admitted CPU consumption");
	require(scheduler.diagnosticCpuSliceConsumedCycles-consumedBefore == consumed
		&& scheduler.diagnosticNativeOriginCycles-nativeBefore == native
		&& scheduler.diagnosticInterpreterRuntimeCycles-interpreterBefore == consumed-native
		&& scheduler.diagnosticNativeOriginCycles+scheduler.diagnosticInterpreterRuntimeCycles
			== scheduler.diagnosticCpuSliceConsumedCycles,
		"native-origin plus interpreter/runtime equals existing consumed cycles after every tested grant");
	Run measured{result, consumed, native, difference(after.nativeOpcodes,before.nativeOpcodes),
		difference(after.interpreterOpcodes,before.interpreterOpcodes)};
	requireCounts(difference(scheduler.diagnosticNativeOpcodes,nativeOpsBefore),measured.native,
		"scheduler copies the native execution-path counts, not prepared or submitted source instructions");
	requireCounts(difference(scheduler.diagnosticInterpreterOpcodes,interpreterOpsBefore),measured.interpreter,
		"scheduler copies exactly the scalar admitted semantic counts");
	require(scheduler.diagnosticNativeOriginCycles==after.nativeOriginCycles,
		"zero-grant worker publication does not lose or duplicate native lifetime consumption");
	requireCounts(scheduler.diagnosticNativeOpcodes,after.nativeOpcodes,"native lifetime counts agree across zero-grant publication");
	requireCounts(scheduler.diagnosticInterpreterOpcodes,after.interpreterOpcodes,"scalar lifetime counts agree across zero-grant publication");
	return measured;
#else
	return {result, consumed};
#endif
}

Run runPair(Fixture& generated, Fixture& scalar, int grant) {
	const auto actual = run(generated,grant), reference = run(scalar,grant);
	require(actual.result == reference.result && actual.consumed == reference.consumed,
		"diagnostic generated and scalar routes preserve exact grants and stop reasons");
	require(encodeRuntimeSaveState(captureRuntimeSaveState(generated.runtime))
		== encodeRuntimeSaveState(captureRuntimeSaveState(scalar.runtime)),
		"diagnostics and native-origin accounting preserve complete guest state");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	requireCounts(total(actual),total(reference),"native and scalar count the same executed semantic instructions");
	require(reference.nativeCycles == 0,"scalar-only execution has zero native-origin cycles");
#if !defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(actual.nativeCycles == 0,"native-disabled builds report zero native-origin cycles");
#endif
#endif
	return actual;
}

test::Blua32TestImage imageWithHandler(u32 words) {
	test::Blua32TestImage image;
	for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	image.text.resize(2u * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text,64,static_cast<u8>(OpCode::HALT),0,0,0);
	writeInstruction(image.text,96,static_cast<u8>(OpCode::RFE),0,0,0);
	image.functions = {{.firstWord=0,.wordCount=words,.maxStack=16},
		{.firstWord=64,.wordCount=1}, {.firstWord=96,.wordCount=1,.maxStack=4}};
	image.exceptionFunctionIndex=1; image.irqFunctionIndex=2;
	return image;
}

test::Blua32TestImage mixedImage() {
	auto image=imageWithHandler(8);
	image.constants={std::string{"field"}};
	writeInstruction(image.text,0,static_cast<u8>(OpCode::NEWT),0,3,2);
	writeInstruction(image.text,1,static_cast<u8>(OpCode::K1),2,0,0);
	writeInstruction(image.text,2,static_cast<u8>(OpCode::SETFIELD),0,0,2);
	writeInstruction(image.text,3,static_cast<u8>(OpCode::CONCAT),3,4,5);
	writeInstruction(image.text,4,static_cast<u8>(OpCode::CONCATN),6,4,2);
	writeInstruction(image.text,5,static_cast<u8>(OpCode::JMPIF),7,0,1);
	writeInstruction(image.text,6,static_cast<u8>(OpCode::NEWT),8,0,0);
	writeInstruction(image.text,7,static_cast<u8>(OpCode::HALT),0,0,0);
	return image;
}

void initializeStrings(Fixture& fixture) {
	auto& cpu=fixture.runtime.machine.cpu;
	fixture.frame().registers.set(4, valueString(cpu.stringPool().intern(std::string("a\0雪",5))));
	fixture.frame().registers.set(5, valueString(cpu.stringPool().intern("tail")));
	fixture.frame().registers.set(7, valueBool(true));
}

std::vector<u8> mixedGrants() {
	Fixture generated(mixedImage(),false),scalar(mixedImage(),true);
	initializeStrings(generated); initializeStrings(scalar);
	for(int grant : {0,1,2,3,5,7,11,64,1024}) {
		const auto measured=runPair(generated,scalar,grant);
		std::cout<<"mixed grant="<<grant<<" consumed="<<measured.consumed
			<<" result="<<static_cast<int>(measured.result)<<'\n';
	}
	require(asTable(generated.frame().registers.get(0), generated.runtime.machine.cpu.gcHeap()).getStringKey(*generated.runtime.machine.cpu.stringPool().find("field"))==valueInteger(1),
		"mixed work actually performs the field write");
	require(generated.frame().registers.get(3)==generated.frame().registers.get(6),"CONCAT and CONCATN produce identical complete strings");
	require(isNil(generated.frame().registers.get(8)),"a compiled but untaken suffix never creates its table");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto& p=generated.runtime.machine.cpu.diagnosticExecutionProfile();
	requireCounts({p.nativeOpcodes.newt+p.interpreterOpcodes.newt,p.nativeOpcodes.call+p.interpreterOpcodes.call,
		p.nativeOpcodes.setfield+p.interpreterOpcodes.setfield,p.nativeOpcodes.concat+p.interpreterOpcodes.concat,
		p.nativeOpcodes.concatn+p.interpreterOpcodes.concatn},{1,0,1,1,1},
		"each completed mixed instruction counts once, excluding the untaken NEWT suffix");
#endif
	return encodeRuntimeSaveState(captureRuntimeSaveState(generated.runtime));
}

void scalarBoundaryRetry() {
	auto image=imageWithHandler(3);
	writeInstruction(image.text,0,static_cast<u8>(OpCode::K1),1,0,0);
	writeInstruction(image.text,1,static_cast<u8>(OpCode::NEWT),0,7,5);
	writeInstruction(image.text,2,static_cast<u8>(OpCode::HALT),0,0,0);
	Fixture generated(image,false),scalar(image,true);
	const auto zero=runPair(generated,scalar,0);
	require(zero.consumed==0,"an exhausted entry executes no instruction");
	[[maybe_unused]] const auto shortGrant=runPair(generated,scalar,1);
	require(generated.frame().registers.get(1)==valueInteger(1) && isNil(generated.frame().registers.get(0)),
		"the insufficient prefix grant executes only the scalar K1, not the unadmitted NEWT suffix");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(shortGrant.nativeCycles==0,"ScalarBoundary refunds the unexecuted native entry before scalar retry");
	requireCounts(total(shortGrant),{},"a declined native suffix counts no allocating semantic attempt");
#endif
	const auto retry=runPair(generated,scalar,1);
	require(retry.consumed>BASE_CYCLES[static_cast<u8>(OpCode::NEWT)],"the admitted NEWT includes dynamic initialization cycles");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	requireCounts(total(retry),{1,0,0,0,0},"the successor retry admits and counts NEWT exactly once");
#endif
	[[maybe_unused]] const auto finish=runPair(generated,scalar,32);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	requireCounts(total(finish),{},"resuming the successor does not count the allocating instruction twice");
#endif
}

void tableWrites() {
	for(int route : {0,1,2}) {
		auto image=imageWithHandler(2); image.constants={std::string{"field"}};
		writeInstruction(image.text,0,static_cast<u8>(OpCode::SETFIELD),0,0,2);
		writeInstruction(image.text,1,static_cast<u8>(OpCode::HALT),0,0,0);
		Fixture generated(image,false),scalar(image,true);
		for(auto* fixture : {&generated,&scalar}) {
			auto& cpu=fixture->runtime.machine.cpu;
			auto table=cpu.createTable(0,2);
			table.setStringKey(cpu.stringPool().intern("field"),valueInteger(11));
			fixture->frame().registers.set(0, valueTable(table.address())); fixture->frame().registers.set(2, valueInteger(73));
		}
		runPair(generated,scalar,32); // Bind the real generated field-cache fast path.
		for(auto* fixture : {&generated,&scalar}) {
			fixture->restart();
			if(route==1) {
				auto& cpu=fixture->runtime.machine.cpu;
				fixture->frame().registers.set(0, valueTable(cpu.createTable(0,0).address()));
			}
			if(route==2) fixture->frame().registers.set(0, valueInteger(19));
		}
		[[maybe_unused]] const auto measured=runPair(generated,scalar,32);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		requireCounts(total(measured),{0,0,1,0,0},"cached, allocating-miss and faulting SETFIELD each count one admitted attempt");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(measured.native.setfield==1 && measured.nativeCycles>0,"all three field routes retain native origin through shared semantic helpers");
#endif
#endif
		if(route==2) require(generated.runtime.machine.cpu.readLuaFaultReasonWord()!=0,"invalid table target actually enters the language-fault boundary");
		else require(asTable(generated.frame().registers.get(0), generated.runtime.machine.cpu.gcHeap()).getStringKey(*generated.runtime.machine.cpu.stringPool().find("field"))==valueInteger(73),
			"both field fast and growth paths perform the actual write");
	}
}

void directCalls() {
	auto image=imageWithHandler(7);
	writeInstruction(image.text,0,static_cast<u8>(OpCode::WIDE),0,0,0);
	writeInstruction(image.text,1,static_cast<u8>(OpCode::CLOSURE),0,0,0);
	writeInstruction(image.text,2,static_cast<u8>(OpCode::CALL),0,1,1);
	writeInstruction(image.text,3,static_cast<u8>(OpCode::WIDE),0,0,0);
	writeInstruction(image.text,4,static_cast<u8>(OpCode::CLOSURE),0,0,0);
	writeInstruction(image.text,5,static_cast<u8>(OpCode::CALL),0,1,1);
	writeInstruction(image.text,6,static_cast<u8>(OpCode::HALT),0,0,0);
	writeInstruction(image.text,32,static_cast<u8>(OpCode::WIDE),0,0,0);
	writeInstruction(image.text,33,static_cast<u8>(OpCode::CLOSURE),0,0,0);
	writeInstruction(image.text,34,static_cast<u8>(OpCode::CALL),0,1,1);
	writeInstruction(image.text,35,static_cast<u8>(OpCode::RET),0,1,0);
	writeInstruction(image.text,48,static_cast<u8>(OpCode::K1),0,0,0);
	writeInstruction(image.text,49,static_cast<u8>(OpCode::RET),0,1,0);
	image.functions.push_back({.firstWord=32,.wordCount=4,.maxStack=4});
	image.functions.push_back({.firstWord=48,.wordCount=2,.maxStack=1});
	image.closureRelocations={{1,test::blua32TestFunctionAddress(RomImageDomain::System,3)},
		{4,test::blua32TestFunctionAddress(RomImageDomain::System,3)},
		{33,test::blua32TestFunctionAddress(RomImageDomain::System,4)}};
	Fixture generated(image,false),scalar(image,true);
	for(int pass=0;pass<2;++pass) {
		if(pass) { generated.restart(); scalar.restart(); }
		[[maybe_unused]] const auto measured=runPair(generated,scalar,512);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		requireCounts(total(measured),{0,4,0,0,0},"nested calls and linked continuations count actual CALL instructions, not native entries");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(measured.native.call==4 && measured.nativeCycles>0,"precompiled direct-call and return chains retain native-origin counts");
#endif
#endif
	}
}

void fetchAndCallFaults() {
	for(bool fetch : {true,false}) {
		auto image=imageWithHandler(2);
		writeInstruction(image.text,0,static_cast<u8>(OpCode::CALL),0,1,1);
		writeInstruction(image.text,1,static_cast<u8>(OpCode::HALT),0,0,0);
		Fixture generated(image,false),scalar(image,true);
		for(auto* fixture : {&generated,&scalar}) {
			fixture->frame().registers.set(0, valueInteger(17));
			if(fetch) fixture->runtime.machine.cpu.writeFrameExecution(0,SYSTEM_EXECUTION_DOMAIN_ID,
				fixture->rom.functionAddresses[0],IO_IRQ_FLAGS);
		}
		[[maybe_unused]] const auto measured=runPair(generated,scalar,32);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		requireCounts(total(measured),{0,fetch?0u:1u,0,0,0},"fetch fault admits no opcode; faulting non-callable CALL counts one attempt before unwind");
#endif
		require(fetch ? generated.runtime.machine.memory.readBusFaultSequence()>0
			: generated.runtime.machine.cpu.readLuaFaultReasonWord()!=0,"the selected actual fetch or language fault was exercised");
	}
}

void interruptBoundary() {
 for(bool nmi : {false,true}) {
	auto image=imageWithHandler(2);
	writeInstruction(image.text,0,static_cast<u8>(OpCode::NEWT),0,0,0);
	writeInstruction(image.text,1,static_cast<u8>(OpCode::JMP),0,63,63,255);
	writeInstruction(image.text,96,static_cast<u8>(OpCode::NEWT),2,0,0);
	writeInstruction(image.text,97,static_cast<u8>(OpCode::RFE),0,0,0);
	image.functions[2].wordCount=2;
	image.exceptionFunctionIndex=2;
	Fixture generated(image,false),scalar(image,true);
	runPair(generated,scalar,1);
	for(auto* fixture : {&generated,&scalar}) {
		if(nmi) fixture->runtime.machine.cpu.requestNonMaskableInterrupt();
		else { fixture->runtime.machine.memory.writeMappedU32LE(IO_IRQ_MASK,IRQ_GPU); fixture->runtime.machine.irqController.raise(IRQ_GPU); }
	}
	[[maybe_unused]] const auto handler=runPair(generated,scalar,1);
	require(generated.runtime.machine.cpu.activeThread()->frameDepth()==2,"the short grant executes the actual interrupt handler in its own frame");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	requireCounts(total(handler),{1,0,0,0,0},"an interrupt entry counts the handler allocation, not a second root allocation");
#endif
	if(!nmi) for(auto* fixture : {&generated,&scalar}) fixture->runtime.machine.irqController.acknowledge(IRQ_GPU);
	runPair(generated,scalar,64);
	require(generated.runtime.machine.cpu.activeThread()->frameDepth()==1
		&& generated.runtime.machine.cpu.readFramePc(0)==generated.rom.textAddress+INSTRUCTION_BYTES,"RFE resumes the interrupted root at its real successor");
 }
}

void lazyCompilation() {
	auto image=imageWithHandler(3); image.constants={std::string{"field"}};
	writeInstruction(image.text,0,static_cast<u8>(OpCode::NEWT),0,0,1);
	writeInstruction(image.text,1,static_cast<u8>(OpCode::SETFIELD),0,0,2);
	writeInstruction(image.text,2,static_cast<u8>(OpCode::JMP),0,63,61,255);
	Fixture generated(image,false,false),scalar(image,true,false);
	for(auto* fixture : {&generated,&scalar}) fixture->frame().registers.set(2, valueInteger(73));
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	generated.runtime.machine.cpu.setNativeCompilationProfiling(true);
#endif
	runPair(generated,scalar,8192);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& cpu=generated.runtime.machine.cpu;
	auto& page=cpu.rootThread()->frameAtDepth(0)->executionImage->decodedPages.at(generated.rom.textAddress & ~MAPPED_PAGE_BYTE_MASK);
	test::waitForNativeEntry(cpu,page,(generated.rom.textAddress & MAPPED_PAGE_BYTE_MASK)/INSTRUCTION_BYTES);
	require(cpu.readNativeCompilationProfile().prepareRequests>0,"the ordinary lazy/worker producer prepared real code");
#endif
	[[maybe_unused]] const auto warm=runPair(generated,scalar,1024);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) && defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(warm.nativeCycles>0 && warm.native.newt>0 && warm.native.setfield>0,
		"lazy/worker-published native code reports executed allocating and field-store paths");
#endif
}

void statisticsAreNotCheckpointState() {
	Fixture fixture(mixedImage(),false); initializeStrings(fixture);
	// Compare actual restored boundaries; GX restore publishes presentation state.
	applyRuntimeSaveState(fixture.runtime,captureRuntimeSaveState(fixture.runtime));
	const auto checkpoint=captureRuntimeSaveState(fixture.runtime);
	const auto bytes=encodeRuntimeSaveState(checkpoint);
	run(fixture,1024);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const auto consumed=fixture.runtime.machine.scheduler.diagnosticCpuSliceConsumedCycles;
	const auto profile=fixture.runtime.machine.cpu.diagnosticExecutionProfile();
	require(consumed>0,"checkpoint test accumulated actual execution diagnostics");
#endif
	applyRuntimeSaveState(fixture.runtime,checkpoint);
	require(encodeRuntimeSaveState(captureRuntimeSaveState(fixture.runtime))==bytes,"checkpoint bytes contain guest state, not host-only execution statistics");
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	require(fixture.runtime.machine.scheduler.diagnosticCpuSliceConsumedCycles==consumed,"restoring guest state does not roll back host diagnostic lifetime totals");
	const auto& restoredProfile=fixture.runtime.machine.cpu.diagnosticExecutionProfile();
	require(restoredProfile.nativeOriginCycles==profile.nativeOriginCycles,"restoring machine state retains native-origin lifetime cycles");
	requireCounts(restoredProfile.nativeOpcodes,profile.nativeOpcodes,"restoring machine state retains native opcode lifetime counts");
	requireCounts(restoredProfile.interpreterOpcodes,profile.interpreterOpcodes,"restoring machine state retains scalar opcode lifetime counts");
	const auto before=encodeRuntimeSaveState(captureRuntimeSaveState(fixture.runtime));
	const auto collections=fixture.runtime.machine.cpu.diagnosticGcProfile().collections;
	(void)fixture.runtime.machine.cpu.diagnosticExecutionProfile();
	require(fixture.runtime.machine.cpu.diagnosticGcProfile().collections==collections,"diagnostic reads do not trigger collection");
	require(encodeRuntimeSaveState(captureRuntimeSaveState(fixture.runtime))==before,"reading backend diagnostics has no guest state, time, MMIO or GC effect");
#endif
}
} // namespace

int main(int argc,char** argv) {
	try {
		std::cout<<"mixed grants\n"; const auto bytes=mixedGrants();
		std::cout<<"scalar boundary\n"; scalarBoundaryRetry();
		std::cout<<"table writes\n"; tableWrites();
		std::cout<<"direct calls\n"; directCalls();
		std::cout<<"faults\n"; fetchAndCallFaults();
		std::cout<<"interrupts\n"; interruptBoundary();
		std::cout<<"lazy compilation\n"; lazyCompilation();
		std::cout<<"checkpoint exclusion\n"; statisticsAreNotCheckpointState();
		if(argc==2) {
			std::ofstream output(argv[1],std::ios::binary);
			output.write(reinterpret_cast<const char*>(bytes.data()),static_cast<std::streamsize>(bytes.size()));
			require(output.good(),"comparison fixture state file was written");
		}
		std::cout<<"CPU backend diagnostics: grants, real opcode paths, faults and checkpoint exclusion passed\n";
		return 0;
	} catch(const std::exception& error) { std::cerr<<error.what()<<'\n'; return 1; }
}
