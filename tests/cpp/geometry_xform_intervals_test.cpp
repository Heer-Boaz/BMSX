#include "machine/devices/geometry/xform2.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/machine.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <limits>
#include <stdexcept>
#include <utility>

using namespace bmsx;
namespace {
constexpr u32 record = (DYNAMIC_RAM_BASE + 0x10000u), vertices = record + 0x100u, matrix = record + 0x1000u, bounds = record + 0x2000u;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
class IdleInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};
GeometryJobState prepare(Memory& memory, u32 count) {
	GeometryJobState job;
	job.src0 = record; job.src1 = vertices; job.src2 = matrix; job.dst0 = vertices + 8u; job.dst1 = bounds;
	job.count = 1u; job.stride0 = 24u; job.stride1 = 8u; job.stride2 = 24u;
	const std::array<u32, 6> recordWords = {0u, 0u, 0u, 0u, count, 0u};
	const std::array<u32, 6> matrixWords = {0x10000u, 0u, 0x10000u, 0u, 0x10000u, 0u};
	for (u32 i = 0; i < 6u; ++i) { memory.writeU32(record + i * 4u, recordWords[i]); memory.writeU32(matrix + i * 4u, matrixWords[i]); }
	for (u32 i = 0; i < count; ++i) {
		memory.writeU32(vertices + i * 8u, i == 0 ? 0x10000u : 0x50000u);
		memory.writeU32(vertices + i * 8u + 4u, i == 0 ? 0x20000u : 0x60000u);
	}
	return job;
}
void testController(u32 count, bool abort) {
	Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IdleInput input;
	Machine machine(memory, input, PSX_MACHINE_SPEC);
	machine.resetDevices(); machine.scheduler.reset();
	require(machine.cpu.heapAllocator().setFloor(bounds + 4u * IO_WORD_SIZE),
		"GEO XFORM operands and bounds fit in public static RAM");
	machine.geometryController.setTiming(PSX_CPU_FREQ_HZ, PSX_GEO_WORK_UNITS_PER_SEC, 0);
	const auto job = prepare(memory, count);
	for (const auto [address, word] : std::array<std::pair<u32, u32>, 9>{{
		{IO_GEO_SRC0, job.src0}, {IO_GEO_SRC1, job.src1}, {IO_GEO_SRC2, job.src2},
		{IO_GEO_DST0, job.dst0}, {IO_GEO_DST1, job.dst1}, {IO_GEO_COUNT, 1u},
		{IO_GEO_STRIDE0, job.stride0}, {IO_GEO_STRIDE1, job.stride1}, {IO_GEO_STRIDE2, job.stride2},
	}}) memory.writeMappedWord(address, word);
	memory.writeMappedWord(IO_GEO_CMD, IO_CMD_GEO_XFORM2_BATCH);
	auto& controller = machine.geometryController;
	u32 events = 0u;
	const auto step = [&]() {
		const i64 now = machine.scheduler.nowCycles(), deadline = machine.scheduler.nextDeadline();
		require(deadline != std::numeric_limits<i64>::max(), "scheduled XFORM interval");
		machine.scheduler.advanceTo(deadline);
		controller.accrueCycles(static_cast<int>(deadline - now), deadline);
		require(machine.scheduler.popDueTimer() == DEVICE_SERVICE_GEO, "GEO timer owns boundary");
		controller.onService(deadline);
		++events;
	};
	require(memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_BUSY, "mapped launch starts XFORM");
	step();
	const auto pending = controller.captureState();
	require(pending.xform.phase == static_cast<u32>(GeometryXform2Phase::Publish), "entire record is pending");
	require(pending.pendingCycles == (count == 64u ? 405 : 29), "word and arithmetic costs use model rate");
	if (count == 64u) require(pending.xform.pendingMemory.ramWords == 272u, "bounded 140 input and 132 future output words");
	const i64 now = machine.scheduler.nowCycles();
	machine.scheduler.advanceTo(now + pending.pendingCycles - 1);
	controller.accrueCycles(static_cast<int>(pending.pendingCycles - 1), now + pending.pendingCycles - 1);
	require(memory.readU32(vertices + 8u) == 0x50000u && memory.readIoU32(IO_GEO_PROCESSED) == 0u, "one cycle before deadline no output is visible");
	if (abort) {
		memory.writeMappedWord(IO_GEO_CTRL, GEO_CTRL_ABORT);
		require(memory.readIoU32(IO_GEO_STATUS) == (GEO_STATUS_DONE | GEO_STATUS_ERROR), "abort reports failure");
		require(memory.readU32(vertices + 8u) == 0x50000u, "abort discards pending output");
		return;
	}
	const auto checkpoint = controller.captureState();
	controller.reset(); controller.restoreState(checkpoint, machine.scheduler.nowCycles());
	step();
	require(events == 2u && machine.scheduler.nextDeadline() == std::numeric_limits<i64>::max(), "exactly two timer services per record");
	require(memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_DONE && memory.readIoU32(IO_GEO_PROCESSED) == 1u, "DONE follows paid publication");
	require(memory.readU32(vertices + 8u) == 0x20000u && memory.readU32(vertices + 16u) == 0x60000u, "overlap uses pre-publication source snapshot");
	const std::array<u32, 4> expected = {0x20000u, 0x20000u, 0x60000u, 0x60000u};
	for (u32 i = 0; i < 4u; ++i) require(memory.readU32(bounds + i * 4u) == expected[i], "published bounds");
}
}
int main() {
	testController(2u, false);
	testController(2u, true);
	testController(64u, false);
	Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	auto job = prepare(memory, 2u);
	GeometryXform2Unit unit(memory);
	auto seed = unit.captureState(); seed.vertices[127] = 0xabcdef01u; unit.restoreState(seed);
	unit.beginJob(); unit.processStep(job);
	require(unit.progress().phase == static_cast<u32>(GeometryXform2Phase::Publish), "record samples full source");
	require(unit.progress().pendingMemory.ramWords == 24u && unit.progress().pendingWorkUnits == 2u, "all input, future output and vertex work counted");
	require(unit.progress().vertices[127] == 0xabcdef01u, "unused FIFO tail remains raw");
	auto checkpoint = unit.captureState();
	memory.writeU32(vertices, 0x90000u); memory.writeU32(matrix + 8u, 0x70000u);
	unit.reset(); unit.restoreState(checkpoint); checkpoint.vertices.fill(0u); checkpoint.bounds.fill(0u);
	unit.processStep(job);
	require(memory.readU32(vertices + 8u) == 0x20000u && memory.readU32(vertices + 16u) == 0x60000u, "deep checkpoint retains source snapshot");
	memory.writeU32(record, 1u); memory.writeU32(record + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, GEO_XFORM2_MAX_VERTICES + 1u);
	unit.beginJob(); unit.processStep(job);
	require(unit.progress().pendingFault == GEO_FAULT_BAD_RECORD_FLAGS && unit.progress().pendingMemory.ramWords == 6u, "flags precede count and pay reached words");
	memory.writeU32(record, 0u); unit.beginJob(); unit.processStep(job);
	require(unit.progress().pendingFault == GEO_FAULT_BAD_VERTEX_COUNT, "invalid vertex count");
	memory.writeU32(record + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, 0u);
	job.src1 = job.src2 = job.dst0 = job.dst1 = 0xffffffffu;
	unit.beginJob(); unit.processStep(job);
	require(unit.progress().phase == static_cast<u32>(GeometryXform2Phase::Complete) && unit.progress().pendingFault == 0u && unit.progress().pendingMemory.ramWords == 6u, "zero vertices do not read later spans");
}
