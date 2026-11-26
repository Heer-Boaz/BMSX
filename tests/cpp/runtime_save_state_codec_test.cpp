#include "machine/runtime/save_state/codec.h"
#include "spec/audio/apu.h"
#include "spec/bmsx/model.h"

#include <algorithm>
#include <atomic>
#include <cstdlib>
#include <new>
#include <stdexcept>

namespace {
std::atomic<size_t> allocations{0};
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}
}

void* operator new(std::size_t size) {
	allocations.fetch_add(1, std::memory_order_relaxed);
	if (void* memory = std::malloc(size)) return memory;
	throw std::bad_alloc();
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }

int main() {
	using namespace bmsx;
	RuntimeSaveState state;
	auto& machine = state.machineState.machine;
	state.ram.assign(PSX_MACHINE_SPEC.ramBytes, 0x5a);
	machine.gxGpu.vramBytes.assign(PSX_MACHINE_SPEC.gxGpuVramBytes, 0x7b);
	machine.audio.sampleRam.assign(APU_SAMPLE_RAM_BYTES, 0x8c);
	machine.gxGpu.commandBuffer.readbackPixelBytes.assign(2 * 1024 * 1024, 0x9d);
	machine.cartridge.slots[0] = CartridgeCardState{std::vector<u8>{}, CartridgeMailboxState{}};
	auto& xform = machine.geometry.xform;
	xform.phase = static_cast<u32>(GeometryXform2Phase::Publish);
	xform.dstAddress = 0x080d0100u; xform.boundsAddress = 0x080d0200u;
	xform.vertexCount = 7u; xform.hasBounds = true;
	for (u32 i = 0; i < xform.vertices.size(); ++i) xform.vertices[i] = i + 1u;
	xform.bounds = {0x80000000u, 0xffffffffu, 1u, 0x7fffffffu};
	xform.pendingMemory = {2u, 0u, 0u, 0u}; xform.pendingWorkUnits = 1u;
	auto& sat = machine.geometry.sat;
	sat.phase = static_cast<u32>(GeometrySat2Phase::Compute);
	sat.vertexAddressA = 0x080d1000u; sat.vertexAddressB = 0x080d1200u; sat.resultAddress = 0x080d1400u;
	sat.countA = 64u; sat.countB = 63u;
	for (u32 i = 0; i < sat.verticesA.size(); ++i) sat.verticesA[i] = i + 1u;
	sat.verticesB.fill(0xffffffffu);
	sat.result = {1u, 0xffffffffu, 0x80000000u, 0x7fffffffu, 0xffffu};
	sat.pendingMemory = {0u, 0u, 126u, 0u};
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
	state.cpuState.concat = {600, 0x1014, 31, 0, 3, 0xfaced00d, 0, 0, {{valueInteger(-7), 600}}, std::string("\0\xff\x80", 3)};
	state.cpuState.stringComparison = {0x80000100u, 0x1000u, 129, 199, -1, true, false};
	state.cpuState.pendingMemory = {PendingMemoryKind::WordStores, 0xfffffffcu, 0u, 0x12345678u, MemoryAccessKind::Word, 7, 9};
	state.cpuState.rebuild = {.record=0x8100u, .key=valueInteger(8193), .value=valueInteger(-9),
		.instructionPc=0x5020u, .census=TableCensus::General, .recovery=LuaAllocationRecovery::Fresh, .density={4100, 3100, 4096, 3096}};
	state.cpuState.rootThreadAddress = 0x083fa000u;
	state.cpuState.activeThreadAddress = 0x083fa040u;
	state.cpuState.completionValues = {valueInteger(INT32_MIN), valueFloatBits(0xffc12345u), valueBuiltinFunction(BuiltinFunctionId::Next)};
	const size_t withoutAssignment = encodeRuntimeSaveState(state).size();
	state.cpuState.pendingAllocation = {
		AllocationRecovery::RetryCurrent, 0x2000u, 0x2004u, 0x2008u,
		0x12345678u, 9u, valueString(0x298u), valueFloatBits(0xffc12345u),
	};
	const size_t beforeOwned = allocations;
	const auto expected = encodeRuntimeSaveState(state);
	require(allocations == beforeOwned + 1, "owned encoding allocates exactly its final byte buffer, not an object tree");
	require(expected.size() - withoutAssignment == 33u, "a parked assignment adds four words, two Values and one byte, with no discriminator");
	std::vector<u8> output(expected.size() + 2, 0xa5);
	const size_t beforeDirect = allocations;
	const auto written = encodeRuntimeSaveState(state, std::span<u8>(output).subspan(1, expected.size()));
	require(allocations == beforeDirect, "caller-owned encoding performs zero heap allocations");
	require(written == expected.size() && std::equal(expected.begin(), expected.end(), output.begin() + 1), "owned and direct encoders are byte identical");
	require(output.front() == 0xa5 && output.back() == 0xa5, "output canaries are intact");
	std::fill(output.begin(), output.end(), 0xa5);
	require(encodeRuntimeSaveState(state, std::span<u8>(output).subspan(1, expected.size() - 1)) == 0, "undersized output is not admitted");
	require(std::ranges::all_of(output, [](u8 value) { return value == 0xa5; }), "capacity admission happens before any output writes");
	const auto decoded = decodeRuntimeSaveState(expected, state.ram.size(), machine.gxGpu.vramBytes.size());
	require(encodeRuntimeSaveState(decoded) == expected, "every stored bit round-trips through typed state");
	require(decoded.cpuState.rebuild == state.cpuState.rebuild, "the partial band and recovery phase survive a binary checkpoint");
	require(decoded.cpuState.concat == state.cpuState.concat, "concat prefix and hash survive the binary CPU codec");
	require(decoded.cpuState.stringComparison == state.cpuState.stringComparison, "String comparison restores both ROM socket identity and scan progress");
	require(decoded.cpuState.pendingAllocation == state.cpuState.pendingAllocation,
		"a parked assignment keeps its exact issue, growth hint and raw guest operands");
	require(decoded.machineState.machine.cartridge.slots[0]->ram.has_value()
		&& !decoded.machineState.machine.cartridge.slots[1].has_value(), "empty RAM and an absent card remain distinct");
}
