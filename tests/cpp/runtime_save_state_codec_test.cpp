#include "machine/runtime/save_state/codec.h"
#include "spec/audio/apu.h"
#include "spec/bmsx/model.h"

#include <algorithm>
#include <cstdlib>
#include <new>
#include <stdexcept>

namespace {
size_t allocations = 0;
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

void* operator new(std::size_t size) {
	++allocations;
	if (void* memory = std::malloc(size)) return memory;
	throw std::bad_alloc();
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }

int main() {
	using namespace bmsx;
	RuntimeSaveState state;
	auto& machine = state.machineState.machine;
	machine.memory.ram.assign(PSX_MACHINE_SPEC.ramBytes, 0x5a);
	machine.gxGpu.vramBytes.assign(PSX_MACHINE_SPEC.gxGpuVramBytes, 0x7b);
	machine.audio.sampleRam.assign(APU_SAMPLE_RAM_BYTES, 0x8c);
	machine.gxGpu.commandBuffer.readbackPixelBytes.assign(2 * 1024 * 1024, 0x9d);
	machine.cartridge.slots[0] = CartridgeCardState{std::vector<u8>{}, CartridgeMailboxState{}};
	auto& overlap = machine.geometry.overlap;
	overlap.phase = 3u; overlap.instanceBIndex = 31u; overlap.pairMeta = 32u;
	overlap.shapeAAddr = 0x1000u; overlap.shapeBAddr = 0x2000u;
	overlap.shapeAOffset = 0x30u; overlap.shapeBOffset = 0x40u;
	overlap.countA = 3u; overlap.countB = 4u; overlap.pieceA = 1u; overlap.pieceB = 2u;
	overlap.compoundA = true; overlap.bestHit = true;
	overlap.bestPieceA = 5u; overlap.bestPieceB = 6u; overlap.bestFeature = 7u;
	overlap.bestDepth = 0.25; overlap.bestNx = -1.0; overlap.bestNy = -0.0;
	overlap.bestPx = 3.5; overlap.bestPy = 4.5;
	for (u32 i = 0; i < overlap.instanceA.size(); ++i) overlap.instanceA[i] = i + 1u;
	overlap.instanceB.fill(0xffffffffu);
	overlap.boundsA = {-1.0, 2.0, 3.0, 4.0};
	overlap.pendingWork = {8u, 64u, 8u, 12u, 16u, 8u, 24u};
	overlap.pendingWriteFlags = 3u; overlap.afterPublishPhase = 1u;
	overlap.pendingMemory = {12u, 13u, 14u, 15u};
	overlap.pendingFault = 9u;
	machine.geometry.pendingCycles = 17;
	machine.memory.busFaultAddr = 0xffffffff;
	state.machineState.schedulerNowCycles = (i64{1} << 40) + 17;
	state.cpuState.pendingMemory = {PendingMemoryKind::WordStores, 0xfffffffcu, 0u, 0x12345678u, MemoryAccessKind::Word, 7, 9};
	state.cpuState.snapshot = CpuSnapshot({0x12345678, 0xffffffff, 0, 0x80000000, 0x7ff81234}, {2});
	const size_t beforeOwned = allocations;
	const auto expected = encodeRuntimeSaveState(state);
	require(allocations == beforeOwned + 1, "owned encoding allocates exactly its final byte buffer, not an object tree");
	std::vector<u8> output(expected.size() + 2, 0xa5);
	const size_t beforeDirect = allocations;
	const auto written = encodeRuntimeSaveState(state, std::span<u8>(output).subspan(1, expected.size()));
	require(allocations == beforeDirect, "caller-owned encoding performs zero heap allocations");
	require(written == expected.size() && std::equal(expected.begin(), expected.end(), output.begin() + 1), "owned and direct encoders are byte identical");
	require(output.front() == 0xa5 && output.back() == 0xa5, "output canaries are intact");
	std::fill(output.begin(), output.end(), 0xa5);
	require(encodeRuntimeSaveState(state, std::span<u8>(output).subspan(1, expected.size() - 1)) == 0, "undersized output is not admitted");
	require(std::ranges::all_of(output, [](u8 value) { return value == 0xa5; }), "capacity admission happens before any output writes");
	const auto decoded = decodeRuntimeSaveState(expected, machine.memory.ram.size(), machine.gxGpu.vramBytes.size());
	require(encodeRuntimeSaveState(decoded) == expected, "every stored bit round-trips through typed state");
	require(decoded.machineState.machine.cartridge.slots[0]->ram.has_value()
		&& !decoded.machineState.machine.cartridge.slots[1].has_value(), "empty RAM and an absent card remain distinct");
}
