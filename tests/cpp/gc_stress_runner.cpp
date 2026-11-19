#include "machine/runtime/runtime.h"
#include "machine/cpu/upvalue.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/bmsx/model.h"

#include <algorithm>
#include <array>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string_view>
#include <vector>
#include <tuple>

namespace {
bool stressEnabled = false;
size_t stressedAllocations = 0;
}

namespace bmsx {
void stressHeapAllocation(LuaHeap& heap) {
	if (!stressEnabled) return;
	heap.setCollectionTarget(0);
	++stressedAllocations;
}
}

class GcStressInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

namespace {
void requireYoung(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void runYoungStage(bmsx::CPU& cpu) {
	for (int call = 0; call < 5000; ++call) {
		const auto result = cpu.runUntilDepth(0, call % 3 == 0 ? 1 : call % 3 == 1 ? 17 : 2048);
		requireYoung(cpu.readExceptionReturnFrameDepth() == -1, "unexpected guest fault in young collection fixture");
		if (result != bmsx::RunResult::Yielded) {
			requireYoung(result == bmsx::RunResult::Halted && cpu.isHaltedUntilIrq(), "the guest reaches its actual phase barrier");
			return;
		}
	}
	throw std::runtime_error("young collection fixture exceeded its bounded grants");
}

void exerciseYoung(bmsx::CPU& cpu, bool compiled) {
	using namespace bmsx;
	auto& memory = cpu.memory();
	const auto global = [&](std::string_view name) { return cpu.getGlobalByKey(*cpu.stringPool().find(name)); };
	runYoungStage(cpu);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (compiled) for (std::string_view name : {"assign", "change"}) {
		const auto prototype = ClosureRecord::readBinding(memory, valuePayload(global(name)));
		MappedPageBinding binding{};
		memory.bindMappedPage(prototype.codeAddress & ~MAPPED_PAGE_BYTE_MASK, MAPPED_BUS_MASTER_CPU, binding);
		auto& page = cpu.rootThread()->currentFrame->executionImage->decodedPages.at(binding.key);
		const u32 word = (prototype.codeAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		requireYoung(page.nativeBlocks && page.nativeBlocks->entries[word], "both mutations execute a real native entry");
	}
#endif
	constexpr std::array<std::string_view, 7> names{"owner", "array_owner", "change", "read", "weak", "entries", "old_text"};
	std::array<Value, names.size()> oldValues{};
	for (size_t i = 0; i < names.size(); ++i) oldValues[i] = global(names[i]);
	const int beforeGrant = cpu.instructionBudgetRemaining;
	requireYoung(!cpu.gcHeap().active() && cpu.gcHeap().collectYoung(valueNil(), valueNil(), valueNil()) > 0u, "seed promotion is an actual idle young collection");
	requireYoung(cpu.instructionBudgetRemaining == beforeGrant, "raw host collection returns work without charging a guest instruction");
	for (Value value : oldValues) requireYoung((memory.readRamRecordByte(valuePayload(value) + GC_COLOR_OFFSET) & GC_OLD) != 0u, "seed objects promote without moving");
	const u32 cell = ClosureRecord::captureAddress(memory, valuePayload(global("change")), 0u);
	requireYoung(!Upvalue::isOpen(memory, cell) && (memory.readRamRecordByte(cell + GC_COLOR_OFFSET) & GC_OLD) != 0u,
		"the mutation targets an actual old closed cell");
	cpu.clearHaltUntilIrq(); runYoungStage(cpu);
	const auto childKey = *cpu.stringPool().find("child"), textKey = *cpu.stringPool().find("text");
	const u32 owner = valuePayload(global("owner")), arrayOwner = valuePayload(global("array_owner"));
	const Value child = TableRecord(cpu.gcHeap(), owner).getStringKey(childKey);
	const Value text = TableRecord(cpu.gcHeap(), owner).getStringKey(textKey);
	const Value arrayChild = TableRecord(cpu.gcHeap(), arrayOwner).getInteger(1), cellChild = Upvalue::load(memory, cell);
	const u32 textId = valuePayload(text);
	for (Value value : {child, arrayChild, cellChild}) requireYoung((memory.readRamRecordByte(valuePayload(value) + GC_COLOR_OFFSET) & GC_OLD) == 0u, "remembered children are actually young before admission pressure");
	requireYoung((memory.readRamRecordByte(textId + 1u) & STRING_GC_OLD) == 0u, "the dynamic String starts young");
	requireYoung(cpu.luaHeap().usedBytes() + 6000u * 32u < cpu.luaHeap().collectionTarget(), "the burst stays below major admission");
	const auto ram = memory.captureSaveState(); const auto state = cpu.captureRuntimeState();
	RamHistory history; RamHistory::PageMap midPages, finalPages;
	history.capture(memory, nullptr, midPages);
	const auto verify = [&] {
		for (size_t i = 0; i < names.size(); ++i) {
			requireYoung(global(names[i]) == oldValues[i], "old identities remain at their original addresses");
			requireYoung((memory.readRamRecordByte(valuePayload(oldValues[i]) + GC_COLOR_OFFSET) & GC_OLD) != 0u, "old records remain old");
		}
		requireYoung(TableRecord(cpu.gcHeap(), owner).getStringKey(childKey) == child
			&& TableRecord(cpu.gcHeap(), owner).getStringKey(textKey) == text, "remembered field edges retain the exact young addresses");
		requireYoung(TableRecord(cpu.gcHeap(), arrayOwner).getInteger(1) == arrayChild && Upvalue::load(memory, cell) == cellChild,
			"independent remembered array and closed-cell edges retain their exact children");
		for (Value value : {child, arrayChild, cellChild}) requireYoung((memory.readRamRecordByte(valuePayload(value) + GC_COLOR_OFFSET) & GC_OLD) != 0u,
			"allocation admission actually ran a minor: major collection never promotes");
		requireYoung((memory.readRamRecordByte(textId + 1u) & STRING_GC_OLD) != 0u
			&& cpu.stringPool().find("young-live:é😀:37") == textId, "the young canonical String promotes in place");
		requireYoung(!cpu.stringPool().find("young-retired:é😀:37"), "the unreachable young String is unlinked and retired");
	};
	cpu.clearHaltUntilIrq(); runYoungStage(cpu); verify();
	const auto finalRam = memory.captureSaveState(); const auto finalState = cpu.captureRuntimeState(); const int remaining = cpu.instructionBudgetRemaining;
	history.capture(memory, &midPages, finalPages);
	history.restore(memory, finalPages, midPages); cpu.restoreRuntimeState(state);
	const auto restored = memory.captureSaveState();
	requireYoung(cpu.captureRuntimeState() == state && std::tie(restored.ram, restored.ramBusEnd, restored.busFaultCode, restored.busFaultAddr, restored.busFaultAccess)
		== std::tie(ram.ram, ram.ramBusEnd, ram.busFaultCode, ram.busFaultAddr, ram.busFaultAccess),
		"remembered pages, young pages, roots and allocation debt rewind together");
	cpu.clearHaltUntilIrq();
	requireYoung(cpu.runUntilDepth(0, 17) == RunResult::Yielded && memory.captureSaveState().ram != ram.ram, "one uncaptured prefix dirties the installed checkpoint");
	history.restore(memory, midPages, midPages); cpu.restoreRuntimeState(state);
	const auto rewound = memory.captureSaveState();
	requireYoung(cpu.captureRuntimeState() == state && std::tie(rewound.ram, rewound.ramBusEnd, rewound.busFaultCode, rewound.busFaultAddr, rewound.busFaultAccess)
		== std::tie(ram.ram, ram.ramBusEnd, ram.busFaultCode, ram.busFaultAddr, ram.busFaultAccess), "same-map seek restores uncaptured dirty pages");
	cpu.clearHaltUntilIrq(); runYoungStage(cpu); verify();
	const auto replayed = memory.captureSaveState();
	requireYoung(cpu.captureRuntimeState() == finalState && std::tie(replayed.ram, replayed.ramBusEnd, replayed.busFaultCode, replayed.busFaultAddr, replayed.busFaultAccess)
		== std::tie(finalRam.ram, finalRam.ramBusEnd, finalRam.busFaultCode, finalRam.busFaultAddr, finalRam.busFaultAccess) && cpu.instructionBudgetRemaining == remaining,
		"replaying the automatic collection suffix reproduces every CPU/RAM byte and grant remainder");
	cpu.clearHaltUntilIrq();
	requireYoung(cpu.runUntilDepth(0, 2048) == RunResult::Halted, "the final phase returns normally");
}
}

int main(int argc, char** argv) {
	try {
		if (argc != 4) throw std::runtime_error("expected ROM, scalar/native, and plain/restore/young");
		std::ifstream file(argv[1], std::ios::binary);
		if (!file) throw std::runtime_error("cannot open GC fixture");
		std::vector<bmsx::u8> rom{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
		GcStressInput input;
		bmsx::Runtime runtime({rom, {}, bmsx::PSX_MACHINE_SPEC}, input);
		runtime.boot();
		auto& cpu = runtime.machine.cpu;
		if (std::string_view(argv[2]) == "scalar") {
			cpu.setExecutionHook({[](void*, bmsx::ExecutionDomainId, bmsx::u32) { return false; }, nullptr, bmsx::ALL_EXECUTION_DOMAINS_MASK, 0});
		} else {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			cpu.prepareSystemNativeCode();
#else
			throw std::runtime_error("native GC stress requires native blocks");
#endif
		}
		const bool restore = std::string_view(argv[3]) == "restore", young = std::string_view(argv[3]) == "young";
		stressEnabled = !young;
		auto result = bmsx::RunResult::Yielded;
		if (young) {
			exerciseYoung(cpu, std::string_view(argv[2]) == "native");
			result = bmsx::RunResult::Halted;
		}
		for (int call = 0; !young && call < 50000 && result == bmsx::RunResult::Yielded; ++call) {
			result = cpu.runUntilDepth(0, call % 3 == 0 ? 1 : call % 3 == 1 ? 17 : 2048);
			if (cpu.readExceptionReturnFrameDepth() != -1) throw std::runtime_error("unexpected guest fault during GC stress");
			if (restore && call % 23 == 0) {
				const auto ram = cpu.memory().captureSaveState();
				const auto state = cpu.captureRuntimeState();
				cpu.memory().restoreSaveState(ram);
				cpu.restoreRuntimeState(state);
				if (cpu.captureRuntimeState() != state)
					throw std::runtime_error("GC stress snapshot round trip changed values");
			}
		}
		stressEnabled = false;
		const auto values = runtime.readCompletionValues();
		if (result != bmsx::RunResult::Halted || values.size() != 1 || values.get(0) != bmsx::valueBool(true)
			|| (!young && stressedAllocations <= 32)) throw std::runtime_error("GC stress fixture did not finish successfully");
		const auto bytes = bmsx::encodeRuntimeSaveState(bmsx::captureRuntimeSaveState(runtime));
		std::ofstream output(std::string(argv[1]) + ".state", std::ios::binary);
		output.exceptions(std::ios::failbit | std::ios::badbit);
		output.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
		output.close();
		std::cout << (young ? "Young GC passed: automatic admission and checkpoint replay\n" : "GC stress passed: " + std::to_string(stressedAllocations) + " allocation boundaries\n");
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
