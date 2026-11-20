#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/scheduler/device.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/rom_header.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include <unistd.h>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct PerfRange {
	std::uintptr_t start;
	size_t bytes;
	std::string symbol;
};

std::vector<PerfRange> readMap() {
	char path[64];
	std::snprintf(path, sizeof(path), "/tmp/perf-%ld.map", static_cast<long>(getpid()));
	std::ifstream input(path);
#if defined(BMSX_NATIVE_PERF_MAP)
	require(input.is_open(), "enabled native publication creates the standard process perf map");
	std::vector<PerfRange> ranges;
	PerfRange range;
	while (input >> std::hex >> range.start) {
		require(static_cast<bool>(input >> range.bytes >> range.symbol), "every map address has its complete size and symbol");
		ranges.push_back(range);
	}
	require(input.eof() && !ranges.empty(), "the map consists of complete standard address/size/name records");
	return ranges;
#else
	require(!input.is_open(), "disabled native diagnostics creates no perf map");
	return {};
#endif
}

struct Images {
	test::Blua32TestRom system;
	std::array<test::Blua32TestRom, 2> cards;
	Images() {
		test::Blua32TestImage bios;
		bios.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(bios.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
		writeInstruction(bios.text, 1, static_cast<u8>(OpCode::LOAD_MEM), 0, 0, static_cast<u8>(MemoryAccessKind::U32LE));
		writeInstruction(bios.text, 2, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
		writeInstruction(bios.text, 3, static_cast<u8>(OpCode::RET), 0, 1, 0);
		bios.constants = {static_cast<i32>(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)};
		bios.functions = {{.firstWord=0, .wordCount=3, .maxStack=4}, {.firstWord=3, .wordCount=1}};
		bios.irqFunctionIndex = bios.exceptionFunctionIndex = 1;
		system = test::encodeBlua32TestRom(RomImageDomain::System, bios, test::RAM_CODE_FIXTURE_BYTES);
		for (u32 slot = 0; slot != cards.size(); ++slot) {
			test::Blua32TestImage cart;
			cart.text.resize(MAPPED_PAGE_BYTE_SIZE);
			writeInstruction(cart.text, 0, static_cast<u8>(OpCode::K0), 0, 0, 0);
			writeInstruction(cart.text, 1, static_cast<u8>(OpCode::LOADK), 1, 0, 0);
			writeInstruction(cart.text, 2, static_cast<u8>(OpCode::ADD), 0, 0, 1);
			writeInstruction(cart.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
			cart.constants = {static_cast<i32>(slot + 1)};
			cart.functions = {{.firstWord=0, .wordCount=4, .maxStack=4}};
			cards[slot] = test::encodeBlua32TestRom(RomImageDomain::Cartridge, cart, test::RAM_CODE_FIXTURE_BYTES);
		}
	}
};

struct Machine {
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	DeviceScheduler scheduler;
	DmaController dma;
	Machine(const Images& images, u32 slot, bool scalar)
		: memory(MemoryInit{images.system.bytes, test::cartridgeSlots(images.cards[0].bytes, images.cards[1].bytes)}, PSX_MACHINE_SPEC.ramBytes),
		  irq(memory), addresses(memory), cpu(memory, irq, addresses), scheduler(cpu), dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		cpu.reset();
		memory.writeMappedU32LE(IO_CART_SELECT, slot);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
	}
};

void publishedAllocationsAndGuestParity(const Images& images, u32 slot) {
	Machine generated(images, slot, false), scalar(images, slot, true);
	auto& cpu = generated.cpu;
	cpu.setNativeCompilationProfiling(true);
#if defined(BMSX_NATIVE_PERF_MAP)
	auto* systemImage = cpu.rootThread()->currentFrame->executionImage;
#endif
	const auto before = cpu.captureRuntimeState();
	const auto ramBefore = cpu.memory().captureSaveState();
	const auto fault = generated.memory.readBusFaultSequence();
	const int budget = cpu.instructionBudgetRemaining;
	cpu.prepareSystemNativeCode();
	const auto prepared = cpu.captureRuntimeState();
	require(before == prepared && cpu.memory().captureSaveState().ram == ramBefore.ram
		&& generated.memory.readBusFaultSequence() == fault && cpu.instructionBudgetRemaining == budget,
		"symbol registration during preparation changes no guest state, bus fault or cycle budget");
	for (const int grant : {0, 1, 2, 3, 7, 31, 32, 67, 257}) {
		test::runCpuParity(cpu, scalar.cpu, grant);
		const auto a = cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
		require(a == b && test::sameLanguageRam(cpu, scalar.cpu)
			&& a.programExecutionDomainId == b.programExecutionDomainId && a.lastPc == b.lastPc,
			"map publication retains interpreter guest graphs and exact instruction boundaries");
		std::cout << "grant " << grant << ' ' << cpu.instructionBudgetRemaining << ' ' << cpu.readCurrentInstructionPc() << '\n';
	}
	const auto profile = cpu.readNativeCompilationProfile();
	std::cout << "code " << profile.codeBytes << ' ' << profile.emittedCodeBytes << ' ' << profile.regionsPublished << ' ' << profile.entriesPublished << '\n';
	const auto state = cpu.captureRuntimeState();
	std::cout << "cpu " << state.lastPc << ' ' << state.activeThreadAddress << ' ' << state.lastExecutionDomainId << '\n';

#if defined(BMSX_NATIVE_PERF_MAP)
	const auto ranges = readMap();
	for (const auto [image, pc] : {std::pair{systemImage, images.system.textAddress},
		std::pair{cpu.rootThread()->currentFrame->executionImage, images.cards[slot].textAddress}}) {
		const u32 sourceSlot = image->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID ? 0u : slot;
		require(image->nativeCodeLookup != nullptr, "the fixture really published backed immutable source code");
		const auto* page = image->nativeCodeLookup->find(pc, sourceSlot);
		require(page && page->nativeBlocks, "system preparation and accepted EXEC publish real native regions");
		for (size_t entry = 0; entry < page->nativeBlocks->entries.size(); ++entry) {
			const auto& block = page->nativeBlocks->entries[entry];
			if (!block) continue;
			auto body = reinterpret_cast<std::uintptr_t>(page->nativeCode[entry]);
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
			body &= ~std::uintptr_t{1};
#endif
			u32 firstPc = block->firstPc;
			for (const auto& candidate : page->nativeBlocks->entries)
				if (candidate && candidate->region == block->region) firstPc = std::min(firstPc, candidate->firstPc);
			char symbol[96];
			std::snprintf(symbol, sizeof(symbol), "bmsx_native_region_domain%d_slot%u_pc%08x", image->executionDomainId, sourceSlot, firstPc);
			const auto match = std::find_if(ranges.begin(), ranges.end(), [&](const PerfRange& range) {
				return range.symbol == symbol && range.bytes == block->region->codeBytes && body >= range.start && body - range.start < range.bytes;
			});
			require(match != ranges.end(), "a published region has its real allocation size, source image/bank/first-entry identity and executable entry in bounds");
		}
	}
#endif
}

void gateRanges() {
	const auto& gate = nativeBlockGate();
	auto base = static_cast<std::uintptr_t>(SLJIT_FUNC_ADDR(gate.entry));
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	base &= ~std::uintptr_t{1};
#endif
	std::cout << "gate";
	for (void* entry : {gate.exit, gate.dispatch, gate.leaveSegment}) {
		auto address = reinterpret_cast<std::uintptr_t>(entry);
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
		address &= ~std::uintptr_t{1};
#endif
		std::cout << ' ' << address - base;
	}
	std::cout << '\n';
#if defined(BMSX_NATIVE_PERF_MAP)
	const auto ranges = readMap();
	constexpr std::array names{"entry", "return_to_cpp", "dispatch", "cold_dispatch", "declined", "call", "ret", "publish", "leave"};
	std::uintptr_t next = base;
	for (const char* name : names) {
		const auto symbol = std::string("bmsx_native_gate_") + name;
		const auto match = std::find_if(ranges.begin(), ranges.end(), [&](const PerfRange& range) { return range.symbol == symbol; });
		require(match != ranges.end() && match->start == next && match->bytes != 0,
			"existing gate labels partition the executable allocation into contiguous nonempty owner ranges");
		require(std::count_if(ranges.begin(), ranges.end(), [&](const PerfRange& range) { return range.symbol == symbol; }) == 1,
			"the stable process gate is registered only once");
		next += match->bytes;
	}
	require(reinterpret_cast<std::uintptr_t>(gate.leaveSegment) >= base && reinterpret_cast<std::uintptr_t>(gate.leaveSegment) < next,
		"the last existing gate label remains inside the mapped allocation");
#else
	readMap();
#endif
}

#if defined(BMSX_NATIVE_COMPILER_WORKER)
void cancelledWorkerIsNotPublished(const Images& images) {
	Machine machine(images, 0, false);
	std::array<u8, 2 * INSTRUCTION_BYTES> text;
	writeInstruction(text, 0, static_cast<u8>(OpCode::ADD), 0, 0, 1);
	writeInstruction(text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	machine.memory.writeBytes(DYNAMIC_RAM_BASE, text.data(), text.size());
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, images.system.functionAddresses[0], DYNAMIC_RAM_BASE);
	machine.cpu.setNativeCompilationProfiling(true);
	const auto prior = readMap().size();
	for (u32 visit = 0; visit != 4 * NATIVE_BLOCK_COMPILATION_THRESHOLD; ++visit) {
		machine.cpu.runUntilDepth(0, 1);
		if (machine.cpu.readNativeCompilationProfile().prepareRequests != 0) break;
	}
	const auto pending = machine.cpu.readNativeCompilationProfile();
	require(pending.prepareRequests == 1 && pending.regionsPublished == 0, "the fixture stops immediately after submitting its first unpublished worker job");
	machine.cpu.setInstructionObserver({});
	const auto cancelled = machine.cpu.readNativeCompilationProfile();
	require(cancelled.backgroundCancelled == 1 && cancelled.codeBytes == 0 && cancelled.regionsPublished == 0,
		"replacing the instruction observer discards the real pending compilation before publication");
	require(readMap().size() == prior, "a cancelled generated allocation has no perf-map publication record");
}
#endif
} // namespace

int main() {
	try {
		char path[64];
		std::snprintf(path, sizeof(path), "/tmp/perf-%ld.map", static_cast<long>(getpid()));
		std::remove(path);
		const Images images;
		for (u32 slot = 0; slot != 2; ++slot) publishedAllocationsAndGuestParity(images, slot);
		gateRanges();
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		cancelledWorkerIsNotPublished(images);
#endif
		std::cout << "Native perf-map owner tests passed\n";
		std::remove(path);
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
