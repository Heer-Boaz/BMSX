#include <chrono>
#include <algorithm>
#include <array>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include "machine/runtime/runtime.h"
#include "machine/cpu/execution_image.h"
#include "machine/runtime/save_state/codec.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"

class BenchmarkInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

// The TypeScript driver owns workload production, repetition, ordering and
// cross-backend state comparison. This executable only runs the supplied ROM.
int main(int argc, char** argv) {
	try {
		if (argc != 5) throw std::runtime_error("Usage: bmsx_cpu_execution_benchmark <rom> <state-output> <grant> <word-count>");
		const int grant = std::stoi(argv[3]);
		const int wordCount = std::stoi(argv[4]);
		if (grant <= 0) throw std::runtime_error("grant must be positive");
		std::ifstream file(argv[1], std::ios::binary);
		if (!file) throw std::runtime_error("cannot open benchmark ROM");
		std::vector<bmsx::u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
		BenchmarkInput input;
		bmsx::Runtime runtime({rom, {}, bmsx::PSX_MACHINE_SPEC}, input);
		runtime.boot();
		auto& cpu = runtime.machine.cpu;
		const auto* image = cpu.rootThread()->frames[0]->executionImage;
		for (int index = 0; index < wordCount; ++index) {
			cpu.rootThread()->frames[0]->registers[8 + index] = bmsx::valueNumber(0x20000000u | (index & 65535u));
		}
		auto result = bmsx::RunResult::Yielded;
		bmsx::i64 cycles = 0;
		const auto start = std::chrono::steady_clock::now();
		while (result == bmsx::RunResult::Yielded) {
			result = cpu.runUntilDepth(0, grant);
			cycles += grant - cpu.instructionBudgetRemaining;
		}
		const double milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
		if (result != bmsx::RunResult::Halted || cpu.getFrameDepth() != 0 || cpu.readCauseWord() != 0
			|| cpu.isHaltedUntilIrq() || cpu.isMemoryWriteBlocked()) throw std::runtime_error("benchmark did not return normally");
		size_t compiledBlocks = 0, codeBytes = 0, compiledSourceWords = 0, distinctPageSourceWords = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		for (const auto& [key, page] : image->decodedPages) {
			if (!page.nativeBlocks) continue;
			std::array<bmsx::u8, bmsx::DECODED_PAGE_WORDS> covered{};
			for (size_t word = 0; word < page.nativeBlocks->entries.size(); ++word) {
				const auto& block = page.nativeBlocks->entries[word];
				if (!block) continue;
				++compiledBlocks;
				codeBytes += block->codeBytes;
				compiledSourceWords += block->sourceWords;
				// Source extents include fetched skip dependencies, not only
				// executed instructions. Count their per-page union separately.
				std::fill(covered.begin() + word, covered.begin() + std::min(word + block->sourceWords, covered.size()), 1);
			}
			distinctPageSourceWords += std::count(covered.begin(), covered.end(), 1);
		}
		constexpr auto backend = "cpp-native";
#else
		(void)image;
		constexpr auto backend = "cpp-interpreter";
#endif
		if (wordCount > 0) {
			constexpr auto address = bmsx::DYNAMIC_RAM_BASE + 0x10000u;
			if (runtime.machine.memory.readMappedWord(address) != 0x20000000u
				|| runtime.machine.memory.readMappedWord(address + (wordCount - 1) * 4) != (0x20000000u | ((wordCount - 1) & 65535u))) {
				throw std::runtime_error("word span did not write its complete RAM range");
			}
		}
		const auto state = bmsx::captureRuntimeSaveState(runtime);
		if (state.cpuState.hardHalted) throw std::runtime_error("benchmark entered the hard HALT latch");
		const auto bytes = bmsx::encodeRuntimeSaveState(state);
		std::ofstream output(argv[2], std::ios::binary);
		output.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
		output.close();
		if (!output) throw std::runtime_error("cannot write benchmark state");
		std::cout << std::setprecision(17) << "{\"backend\":\"" << backend << "\",\"activeCycles\":" << cycles
			<< ",\"idleCycles\":0,\"milliseconds\":" << milliseconds
			<< ",\"megahertz\":" << cycles / milliseconds / 1000.0
			<< ",\"remainingCycles\":" << cpu.instructionBudgetRemaining
			<< ",\"currentPc\":" << cpu.readCurrentInstructionPc() << ",\"lastPc\":" << cpu.lastPc
			<< ",\"compiledBlocks\":" << compiledBlocks << ",\"codeBytes\":" << codeBytes
			<< ",\"compiledSourceWords\":" << compiledSourceWords << ",\"distinctPageSourceWords\":" << distinctPageSourceWords << "}\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
