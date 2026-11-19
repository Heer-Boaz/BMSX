#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/cpu/native_compilation_profile.h"
#include "spec/blua32/image_format.h"
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
		require(argc == 4, "usage: firmware_fsm_runner SYSTEM_ROM CART_ROM OUTPUT_PREFIX");
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
		std::array<std::weak_ptr<NativeCodeRegion>, 2> retainedRegions;
		std::array<void*, 2> retainedEntries{};
#endif
		runtime.boot();
		const auto* firmware = cpu.rootThread()->currentFrame->executionImage;
		u32 primaryFunction = 0;
		u64 activeCycles = 0;
		NativeCompilationProfile previous;
		// No restore or instruction observer: both would change the native cache being measured.
		for (int phase = 0; phase <= 8; ++phase) {
			constexpr int grant = 100000000;
			const auto result = cpu.runUntilDepth(0, grant);
			activeCycles += grant - cpu.instructionBudgetRemaining;
			require(result == RunResult::Halted && cpu.readExceptionReturnFrameDepth() == -1,
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
				<< ",\"capacityFlushes\":" << profile.capacityFlushes
				<< ",\"prepareNanoseconds\":" << profile.prepareNanoseconds
				<< ",\"evaluators\":[";
			if (phase >= 1 && phase < 8) {
				const auto count = phase >= 5 ? 2 : 1;
				for (int evaluator = 0; evaluator < count; ++evaluator) {
					const auto& closure = *asClosure(cpu.getGlobalByKey(*cpu.stringPool().find(evaluator == 0 ? "fsm_evaluator" : "fsm_other")), cpu.gcHeap());
					require(closure.prototype->executionDomainId == firmware->executionDomainId, "inspect the evaluator in its firmware execution image");
					const u32 address = closure.prototype->functionAddress;
					const u32 code = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
					const u32 bytes = memory.readMappedU32LE(address + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
					require(address >= DYNAMIC_RAM_BASE && address + BLUA32_FUNCTION_RECORD_SIZE <= RAM_BASE + PSX_MACHINE_SPEC.ramBytes
						&& code >= DYNAMIC_RAM_BASE && code + bytes <= RAM_BASE + PSX_MACHINE_SPEC.ramBytes,
						"the actual firmware linker must produce RAM records and code");
					if (phase == 1) primaryFunction = address;
					if (evaluator == 0) require(address == primaryFunction, "retained evaluator function changed");
					else require(address != primaryFunction, "a new shape must have its own generated function");
					bool compiled = false;
					size_t regionBytes = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
					const auto* page = firmware->nativeCodeLookup ? firmware->nativeCodeLookup->find(code, 0) : nullptr;
					const u32 word = (code & (MAPPED_PAGE_BYTE_SIZE - 1u)) / 4u;
					if (page && page->nativeBlocks && page->nativeBlocks->entries[word]) {
						const auto& block = *page->nativeBlocks->entries[word];
						compiled = page->nativeCode[word] != nullptr
							&& page->words[word].dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeBlock);
						regionBytes = block.region->codeBytes;
						if ((evaluator == 0 && phase >= 2) || (evaluator == 1 && phase >= 6)) {
							auto& retained = retainedRegions[evaluator];
							if ((evaluator == 0 && phase == 2) || (evaluator == 1 && phase == 6)) {
								retained = block.region;
								retainedEntries[evaluator] = page->nativeCode[word];
							} else {
								require(!retained.expired() && !retained.owner_before(block.region)
									&& !block.region.owner_before(retained)
									&& retainedEntries[evaluator] == page->nativeCode[word],
									"warm evaluator owner/entry replaced during retained execution/binding");
							}
						}
					}
					if ((evaluator == 0 && phase >= 2) || (evaluator == 1 && phase >= 6))
						require(compiled, "actual firmware evaluator did not acquire its specific native entry");
#endif
					if (evaluator != 0) std::cout << ',';
					std::cout << "{\"function\":" << address << ",\"code\":" << code << ",\"bytecodeBytes\":" << bytes
						<< ",\"compiled\":" << (compiled ? "true" : "false") << ",\"regionBytes\":" << regionBytes << '}';
				}
				if (phase >= 4) {
					const auto& bindings = *asTable(cpu.getGlobalByKey(*cpu.stringPool().find("fsm_bindings")), cpu.gcHeap());
					for (int index = 1; index <= 32; ++index)
						require(asClosure(bindings.getInteger(index), cpu.gcHeap())->prototype->functionAddress == primaryFunction,
							"same-shape binding regenerated code instead of sharing the factory's evaluator");
				}
			}
			std::cout << "]}\n";
			previous = profile;
			const auto state = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
			std::ofstream output(std::string(argv[3]) + "." + std::to_string(phase) + ".state", std::ios::binary);
			output.write(reinterpret_cast<const char*>(state.data()), state.size());
			if (phase != 8) cpu.clearHaltUntilIrq();
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
