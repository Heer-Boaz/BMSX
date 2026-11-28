#include "support/gc_heap_reference.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/jit/runtime/block.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include "machine/runtime/runtime.h"
#include "machine/cpu/jit/runtime/compilation_profile.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"

using namespace bmsx;

class FsmInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int main(int argc, char** argv) {
	try {
		require(argc == 3, "usage: firmware_fsm_runner SYSTEM_ROM CART_ROM");
		std::ifstream file(argv[1], std::ios::binary);
		require(file.good(), "cannot read firmware FSM fixture");
		std::vector<u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
		std::ifstream cartFile(argv[2], std::ios::binary);
		require(cartFile.good(), "cannot read firmware FSM cartridge");
		std::vector<u8> cart{std::istreambuf_iterator<char>(cartFile), std::istreambuf_iterator<char>()};
		FsmInput input;
		const CartridgeSocketMediaPair slots{{CartridgeCardMedia{cart, std::nullopt, false}, std::nullopt}};
		Runtime runtime({rom, slots, PSX_MACHINE_SPEC}, input);
		auto& cpu = runtime.machine.cpu;
		auto& memory = runtime.machine.memory;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		cpu.setNativeCompilationProfiling(true);
		std::weak_ptr<NativeCodeRegion> retainedRegion;
		void* retainedEntry = nullptr;
#endif
		runtime.boot();
		u32 primaryFunction = 0;
		u64 activeCycles = 0;
		NativeCompilationProfile previous;
		// No restore or instruction observer: both would change the native cache being measured.
		for (int phase = 0; phase <= 8; ++phase) {
			constexpr int grant = 1000000;
			const auto result = cpu.runUntilDepth(0, grant);
			activeCycles += grant - cpu.instructionBudgetRemaining;
			require(result == RunResult::Halted && cpu.readLuaFaultReasonWord() == 0 && cpu.readExceptionReturnFrameDepth() == -1,
				"firmware FSM phase must reach its real HALT/completion without a fault");
			require(cpu.isHaltedUntilIrq() == (phase != 8), "unexpected firmware FSM checkpoint");
			if (phase != 8) require(cpu.getGlobalByKey(*cpu.stringPool().find("fsm_phase")) == valueInteger(phase), "wrong firmware FSM phase");
			if (phase == 8) {
				const auto values = runtime.readCompletionValues();
				require(values.size() == 2 && values.get(0) == valueBool(true) && values.get(1) == valueBool(true),
					"firmware FSM guest assertions failed");
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			const auto profile = cpu.readNativeCompilationProfile();
#else
			const NativeCompilationProfile profile;
#endif
			std::cout << "{\"phase\":" << phase << ",\"activeCycles\":" << activeCycles
				<< ",\"remainingCycles\":" << cpu.instructionBudgetRemaining
				<< ",\"prepareRequests\":" << profile.prepareRequests
				<< ",\"newPrepares\":" << profile.prepareRequests - previous.prepareRequests
				<< ",\"regionsPublished\":" << profile.regionsPublished
				<< ",\"newRegions\":" << profile.regionsPublished - previous.regionsPublished
				<< ",\"mergedRegions\":" << profile.mergedRegions
				<< ",\"newMerges\":" << profile.mergedRegions - previous.mergedRegions
				<< ",\"emittedCodeBytes\":" << profile.emittedCodeBytes
				<< ",\"liveCodeBytes\":" << profile.codeBytes
				<< ",\"capacityEvictedRegions\":" << profile.capacityEvictedRegions
				<< ",\"prepareNanoseconds\":" << profile.prepareNanoseconds
				<< ",\"evaluators\":[";
			if (phase >= 1 && phase < 8) {
				const auto* image = cpu.rootThread()->currentFrame->executionImage;
				const u32 cartEnd = CART_ROM_BASE + static_cast<u32>(cart.size());
				const auto count = phase >= 5 ? 2 : 1;
				for (int evaluator = 0; evaluator < count; ++evaluator) {
					const auto closure = bmsx::test::asClosure(cpu.getGlobalByKey(*cpu.stringPool().find(evaluator == 0 ? "fsm_evaluator" : "fsm_other")), bmsx::test::GcHeap(cpu));
					require(cpu.readClosureBinding(closure).executionDomainId == image->executionDomainId, "inspect the evaluator in its cartridge execution image");
					const u32 address = cpu.readClosureBinding(closure).functionAddress;
					const u32 code = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
					const u32 bytes = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
					require(address >= CART_ROM_BASE && address + BLUA32_FUNCTION_RECORD_SIZE <= cartEnd
						&& code >= CART_ROM_BASE && code + bytes <= cartEnd,
						"bound evaluators execute code from the cart ROM");
					if (phase == 1) primaryFunction = address;
					require(address == primaryFunction, "different topology binds the same ROM evaluator");
					bool compiled = false;
					size_t regionBytes = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
					const auto* page = image->nativeCodeLookup ? image->nativeCodeLookup->find(code, 0) : nullptr;
					const u32 word = (code & (MAPPED_PAGE_BYTE_SIZE - 1u)) / 4u;
					if (page && page->nativeBlocks && page->nativeBlocks->entries[word]) {
						const auto& block = *page->nativeBlocks->entries[word];
						compiled = page->nativeCode[word] != nullptr
							&& page->words[word].dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeBlock);
						regionBytes = block.region->codeBytes;
						if (phase >= 2) {
							if (phase == 2) {
								retainedRegion = block.region;
								retainedEntry = page->nativeCode[word];
							} else {
								require(!retainedRegion.expired() && !retainedRegion.owner_before(block.region)
									&& !block.region.owner_before(retainedRegion)
									&& retainedEntry == page->nativeCode[word],
									"warm evaluator owner/entry replaced during retained execution/binding");
							}
						}
					}
					if (phase >= 2) require(compiled, "ROM evaluator did not acquire its specific native entry");
#endif
					if (evaluator != 0) std::cout << ',';
					std::cout << "{\"function\":" << address << ",\"code\":" << code << ",\"bytecodeBytes\":" << bytes
						<< ",\"compiled\":" << (compiled ? "true" : "false") << ",\"regionBytes\":" << regionBytes << '}';
				}
				if (phase >= 4) {
					const auto& bindings = TableRecord(cpu.memory(), valuePayload(cpu.getGlobalByKey(*cpu.stringPool().find("fsm_bindings"))));
					for (int index = 1; index <= 3; ++index)
						require(cpu.readClosureBinding(bmsx::test::asClosure(bindings.getInteger(index), bmsx::test::GcHeap(cpu))).functionAddress == primaryFunction,
							"binding did not retain its ROM evaluator");
				}
			}
			std::cout << "]}\n";
			previous = profile;
			if (phase != 8) cpu.clearHaltUntilIrq();
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
