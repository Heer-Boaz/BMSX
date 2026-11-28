#include "support/heap_allocator_reference.h"
#include "machine/devices/geometry/sat2.h"
#include "machine/machine.h"
#include "machine/devices/geometry/contracts.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <stdexcept>
#include <limits>
#include <utility>

using namespace bmsx;
namespace {
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
}

class IdleInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

void testController(bool abort) {
	Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IdleInput input;
	Machine machine(memory, input, PSX_MACHINE_SPEC);
	machine.resetDevices(); machine.scheduler.reset();
	machine.geometryController.setTiming(PSX_MACHINE_SPEC.cpuFreqHz, PSX_MACHINE_SPEC.geoWorkUnitsPerSec);
	const u32 record = (DYNAMIC_RAM_BASE + 0x10000u), descriptors = record + 0x100u, vertices = record + 0x200u, result = record + 0x400u;
	require(bmsx::HeapAllocator(machine.cpu.memory()).setFloor(result + GEO_SAT2_RESULT_BYTES),
		"GEO SAT operands and result occupy public static RAM");
	const std::array<u32, 5> pair = {0u, 0u, 0u, 1u, 0u};
	const std::array<u32, 8> desc = {1u, 4u, 0u, 0u, 1u, 4u, 32u, 0u};
	const std::array<u32, 16> coords = {0u, 0u, 0x40000u, 0u, 0x40000u, 0x40000u, 0u, 0x40000u,
		0x10000u, 0x10000u, 0x50000u, 0x10000u, 0x50000u, 0x50000u, 0x10000u, 0x50000u};
	for (u32 i = 0; i < pair.size(); ++i) memory.writeU32(record + i * 4u, pair[i]);
	for (u32 i = 0; i < desc.size(); ++i) memory.writeU32(descriptors + i * 4u, desc[i]);
	for (u32 i = 0; i < coords.size(); ++i) memory.writeU32(vertices + i * 4u, coords[i]);
	for (u32 i = 0; i < 5u; ++i) memory.writeU32(result + i * 4u, 0xdeadbeefu);
	for (const auto [address, word] : std::array<std::pair<u32, u32>, 7>{{
		{IO_GEO_SRC0, record}, {IO_GEO_SRC1, descriptors}, {IO_GEO_SRC2, vertices},
		{IO_GEO_DST0, result}, {IO_GEO_COUNT, 1u}, {IO_GEO_STRIDE0, 20u}, {IO_GEO_STRIDE1, 16u},
	}}) memory.writeMappedWord(address, word);
	memory.writeMappedWord(IO_GEO_CMD, IO_CMD_GEO_SAT2_BATCH);
	auto& controller = machine.geometryController;
	const auto step = [&]() {
		const i64 deadline = machine.scheduler.nextDeadline();
		require(deadline != std::numeric_limits<i64>::max(), "scheduled SAT interval");
		machine.scheduler.advanceTo(deadline);

		require(machine.scheduler.popDueTimer() == DEVICE_SERVICE_GEO, "GEO timer owns boundary");
		controller.onService(deadline);
	};
	require(memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_BUSY, "SAT starts");
	step();
	require(controller.captureState().sat.phase == static_cast<u32>(GeometrySat2Phase::LoadA) && controller.captureState().pendingCycles == 13, "record price");
	step();
	require(controller.captureState().sat.phase == static_cast<u32>(GeometrySat2Phase::LoadB) && controller.captureState().pendingCycles == 8, "A price");
	const auto afterA = controller.captureState();
	memory.writeU32(vertices, 0x70000u);
	controller.reset(); controller.restoreState(afterA, machine.scheduler.nowCycles());
	step();
	require(controller.captureState().sat.phase == static_cast<u32>(GeometrySat2Phase::Compute) && controller.captureState().pendingCycles == 8, "B price");
	memory.writeU32(vertices + 32u, 0x70000u);
	step();
	require(controller.captureState().sat.phase == static_cast<u32>(GeometrySat2Phase::Publish), "unpaid result retained");
	const i64 debt = controller.captureState().pendingCycles, now = machine.scheduler.nowCycles();
	require(debt == 229, "108 work units and five result words use the installed clock");
	machine.scheduler.advanceTo(now + debt - 1);

	require(memory.readU32(result) == 0xdeadbeefu && memory.readIoU32(IO_GEO_PROCESSED) == 0u && memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_BUSY, "unpaid result stays private");
	if (abort) {
		memory.writeMappedWord(IO_GEO_CTRL, GEO_CTRL_ABORT);
		require(memory.readIoU32(IO_GEO_STATUS) == (GEO_STATUS_DONE | GEO_STATUS_ERROR), "abort reports failure");
		require(memory.readU32(result) == 0xdeadbeefu && memory.readIoU32(IO_GEO_PROCESSED) == 0u, "abort discards output");
		return;
	}
	const auto beforePublish = controller.captureState();
	controller.reset(); controller.restoreState(beforePublish, machine.scheduler.nowCycles());
	step();
	const std::array<u32, 5> expected = {1u, 0u, 0x10000u, 0x30000u, 0u};
	for (u32 i = 0; i < expected.size(); ++i) require(memory.readU32(result + i * 4u) == expected[i], "restored output");
	require(memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_DONE && memory.readIoU32(IO_GEO_PROCESSED) == 1u, "DONE after paid output");
	require(machine.scheduler.nowCycles() == 258, "complete RAM pair time");
}

int main() {
	testController(false);
	testController(true);
	Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	const u32 record = (DYNAMIC_RAM_BASE + 0x10000u), descriptors = record + 0x100u, vertices = record + 0x200u, result = record + 0x400u;
	GeometryJobState job;
	job.src0 = record; job.src1 = descriptors; job.src2 = vertices; job.dst0 = result;
	job.count = 1u; job.stride0 = 20u; job.stride1 = 16u;
	const std::array<u32, 5> pair = {0u, 0u, 0u, 1u, 0u};
	const std::array<u32, 8> desc = {1u, 4u, 0u, 0u, 1u, 4u, 32u, 0u};
	const std::array<u32, 16> coords = {0u, 0u, 0x40000u, 0u, 0x40000u, 0x40000u, 0u, 0x40000u,
		0x10000u, 0x10000u, 0x50000u, 0x10000u, 0x50000u, 0x50000u, 0x10000u, 0x50000u};
	for (u32 i = 0; i < pair.size(); ++i) memory.writeU32(record + i * 4u, pair[i]);
	for (u32 i = 0; i < desc.size(); ++i) memory.writeU32(descriptors + i * 4u, desc[i]);
	for (u32 i = 0; i < coords.size(); ++i) memory.writeU32(vertices + i * 4u, coords[i]);
	for (u32 i = 0; i < 5u; ++i) memory.writeU32(result + i * 4u, 0xdeadbeefu);
	GeometrySat2Unit unit(memory);
	unit.beginJob(); unit.processStep(job);
	require(unit.progress().phase == static_cast<u32>(GeometrySat2Phase::LoadA) && unit.progress().pendingMemory.ramWords == 13u, "record and descriptors sampled");
	unit.processStep(job);
	require(unit.progress().phase == static_cast<u32>(GeometrySat2Phase::LoadB) && unit.progress().pendingMemory.ramWords == 8u, "A sampled");
	auto checkpoint = unit.captureState();
	memory.writeU32(vertices, 0x70000u);
	unit.reset(); unit.restoreState(checkpoint); checkpoint.verticesA.fill(0xffffffffu);
	unit.processStep(job);
	require(unit.progress().phase == static_cast<u32>(GeometrySat2Phase::Compute) && unit.progress().pendingMemory.ramWords == 8u, "B sampled");
	memory.writeU32(vertices + 32u, 0x70000u);
	unit.processStep(job);
	require(unit.progress().phase == static_cast<u32>(GeometrySat2Phase::Publish) && unit.progress().pendingMemory.ramWords == 5u && unit.progress().pendingWorkUnits == 108u, "result write and calculation paid before publication");
	require(memory.readU32(result) == 0xdeadbeefu, "output waits");
	checkpoint = unit.captureState();
	unit.reset(); unit.restoreState(checkpoint); checkpoint.result.fill(0xffffffffu);
	unit.processStep(job);
	const std::array<u32, 5> expected = {1u, 0u, 0x10000u, 0x30000u, 0u};
	for (u32 i = 0; i < 5u; ++i) require(memory.readU32(result + i * 4u) == expected[i], "latched result");
	require(unit.progress().phase == static_cast<u32>(GeometrySat2Phase::Complete), "record complete");
	for (u32 i = 0; i < 16u; ++i) memory.writeU32(vertices + i * 4u, 0u);
	memory.writeU32(result, 0xdeadbeefu);
	unit.beginJob(); for (u32 i = 0; i < 4u; ++i) unit.processStep(job);
	require(unit.progress().phase == static_cast<u32>(GeometrySat2Phase::Complete) && unit.progress().pendingFault == GEO_FAULT_DESCRIPTOR_KIND && unit.progress().pendingWorkUnits == 28u, "zero axes fault after counted work");
	require(memory.readU32(result) == 0xdeadbeefu, "fault does not write");
	memory.writeU32(record, 1u); job.dst0 = 0xffffffffu;
	unit.beginJob(); unit.processStep(job);
	require(unit.progress().pendingFault == GEO_FAULT_BAD_RECORD_FLAGS && unit.progress().pendingMemory.ramWords == 5u, "flags precede invalid result");
}
