#include "machine/common/numeric.h"
#include "machine/machine.h"
#include "machine/devices/geometry/overlap2d.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <stdexcept>

using namespace bmsx;

namespace {
constexpr u32 instances = GEO_SCRATCH_BASE;
constexpr u32 shapes = GEO_SCRATCH_BASE + 0x100u;
constexpr u32 vertices = GEO_SCRATCH_BASE + 0x200u;
constexpr u32 result = GEO_SCRATCH_BASE + 0x400u;
constexpr u32 summary = GEO_SCRATCH_BASE + 0x500u;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class IdleInput final : public InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(InputControllerSnapshot&, InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(i32, f64, f64) override {}
};

GeometryJobState writeCase(Memory& memory) {
	const std::array<u32, 10> instanceWords = {shapes, 0u, 0u, 1u, 1u, shapes + 32u, 0u, 0u, 1u, 1u};
	for (u32 i = 0; i < instanceWords.size(); ++i) memory.writeU32(instances + i * IO_WORD_SIZE, instanceWords[i]);
	const std::array<u32, 16> shapeWords = {
		GEO_PRIMITIVE_CONVEX_POLY, 4u, vertices - shapes, 16u, 0u, 0u, 0u, 0u,
		GEO_PRIMITIVE_CONVEX_POLY, 4u, vertices - shapes, 16u, 0u, 0u, 0u, 0u,
	};
	for (u32 i = 0; i < shapeWords.size(); ++i) memory.writeU32(shapes + i * IO_WORD_SIZE, shapeWords[i]);
	const std::array<float, 16> coordinates = {0, 0, 4, 0, 4, 4, 0, 4, 1, 1, 5, 1, 5, 5, 1, 5};
	for (u32 i = 0; i < coordinates.size(); ++i) memory.writeU32(vertices + i * IO_WORD_SIZE, numberToF32Bits(coordinates[i]));
	for (u32 i = 0; i < GEO_OVERLAP2D_RESULT_BYTES / IO_WORD_SIZE; ++i) memory.writeU32(result + i * IO_WORD_SIZE, 0xdeadbeefu);
	GeometryJobState job;
	job.cmd = IO_CMD_GEO_OVERLAP2D_PASS;
	job.src0 = instances;
	job.dst0 = result;
	job.dst1 = summary;
	job.count = 2u;
	job.param0 = GEO_OVERLAP2D_MODE_FULL_PASS;
	job.param1 = 1u;
	job.stride0 = GEO_OVERLAP2D_INSTANCE_BYTES;
	return job;
}

void requireUnpublished(Memory& memory) {
	for (u32 i = 0; i < GEO_OVERLAP2D_RESULT_BYTES / IO_WORD_SIZE; ++i)
		require(memory.readU32(result + i * IO_WORD_SIZE) == 0xdeadbeefu, "calculation must not publish a pending contact");
}
}

int main() {
	{
		Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		auto job = writeCase(memory);
		job.count = 0xffffffffu;
		GeometryOverlap2dUnit unit(memory);
		for (u32 phase : {1u, 2u, 3u}) {
			require(unit.processStep(job) == 0u, "bounded full-pass step succeeds");
			require(unit.progress().phase == phase, "one step never exhausts the full-pass instance count");
			require(job.resultCount == 0u, "calculation retains a provisional result");
		}
		requireUnpublished(memory);
		require(unit.progress().pendingWork.axes == 8u && unit.progress().pendingWork.squareRoots == 8u
			&& unit.progress().pendingWork.projectionVertices == 64u, "work counters reflect the actual visited axes and vertices");
	}
	{
		Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		auto job = writeCase(memory);
		GeometryOverlap2dUnit unit(memory);
		for (int i = 0; i < 3; ++i) require(unit.processStep(job) == 0u, "contact calculation succeeds");
		auto checkpoint = unit.captureState();
		for (u32 i = 0; i < 16u; ++i) memory.writeU32(vertices + i * IO_WORD_SIZE, 0u);
		unit.reset();
		require(checkpoint.pendingWork.axes == 8u, "reset does not mutate an earlier checkpoint");
		unit.restoreState(checkpoint);
		checkpoint.instanceA.fill(0u);
		checkpoint.pendingWork.axes = 0u;
		require(unit.progress().pendingWork.axes == 8u, "restore owns its retained state");
		for (int i = 0; i < 2 && job.resultCount == 0u; ++i)
			require(unit.processStep(job) == 0u, "retained contact publishes successfully");
		require(job.resultCount == 1u, "publication completes in its bounded output phase");
		const std::array<u32, 9> expected = {0u, 0xbf800000u, 0x40400000u, 0x40200000u, 0x40200000u, 0u, 0u, 0u, 1u};
		for (u32 i = 0; i < expected.size(); ++i)
			require(memory.readU32(result + i * IO_WORD_SIZE) == expected[i], "publication uses retained contact, not modified source vertices");
	}
	for (u32 side : {0u, 1u}) {
		Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		auto job = writeCase(memory);
		const u32 instance = instances + side * GEO_OVERLAP2D_INSTANCE_BYTES;
		const u32 shape = memory.readU32(instance + GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
		const u32 compound = instances + 2u * GEO_OVERLAP2D_INSTANCE_BYTES;
		memory.writeU32(compound + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, GEO_OVERLAP2D_SHAPE_KIND_COMPOUND);
		memory.writeU32(compound + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, 0xffffffffu);
		memory.writeU32(compound + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, shape - compound);
		memory.writeU32(compound + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, shape + 16u - compound);
		memory.writeU32(instance + GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET, compound);
		GeometryOverlap2dUnit unit(memory);
		for (int i = 0; i < 4; ++i) require(unit.processStep(job) == 0u, "one compound pair succeeds");
		require(unit.progress().phase == 2u && unit.progress().pieceA == (side == 0u ? 1u : 0u)
			&& unit.progress().pieceB == (side == 1u ? 1u : 0u), "one step does not exhaust either compound-piece dimension");
		require(job.resultCount == 0u, "best-contact reduction waits for later pieces");
		requireUnpublished(memory);
	}
	for (bool abort : {false, true}) {
		Memory memory({{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		auto job = writeCase(memory);
		IdleInput input;
		Machine machine(memory, input, PSX_MACHINE_SPEC);
		machine.resetDevices();
		machine.scheduler.reset();
		memory.writeMappedWord(IO_GEO_SRC0, job.src0);
		memory.writeMappedWord(IO_GEO_DST0, job.dst0);
		memory.writeMappedWord(IO_GEO_DST1, job.dst1);
		memory.writeMappedWord(IO_GEO_COUNT, job.count);
		memory.writeMappedWord(IO_GEO_PARAM0, job.param0);
		memory.writeMappedWord(IO_GEO_PARAM1, job.param1);
		memory.writeMappedWord(IO_GEO_STRIDE0, job.stride0);
		memory.writeMappedWord(IO_GEO_CMD, job.cmd);
		auto& controller = machine.geometryController;
		const auto advance = [&](i64 cycles) {
			machine.advanceDevices(static_cast<int>(cycles));
			controller.onService(machine.scheduler.nowCycles());
		};
		controller.onService(0);
		require(controller.captureState().pendingCycles == 4, "initial summary pays four write cycles before publication");
		advance(4);
		require(controller.captureState().pendingCycles == 26, "one bounded read group samples the instance and pair headers");
		advance(26);
		const auto calculated = controller.captureState();
		require(calculated.overlap.phase == 3u && calculated.pendingCycles > calculated.overlap.pendingMemory.ramWords,
			"bounded piece math remains private until its work debt is paid");
		advance(calculated.pendingCycles - 1);
		requireUnpublished(memory);
		require(memory.readIoU32(IO_GEO_PROCESSED) == 0u && memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_BUSY,
			"neither progress nor status completes one cycle before the math boundary");
		const auto checkpoint = controller.captureState();
		controller.reset();
		controller.restoreState(checkpoint, machine.scheduler.nowCycles());
		require(machine.scheduler.nextDeadline() == machine.scheduler.nowCycles() + 1, "restore preserves the remaining device cycle");
		advance(1);
		require(controller.captureState().overlap.phase == 4u && controller.captureState().pendingCycles == 13,
			"nine result and four summary words have an unpaid publication phase");
		if (abort) {
			memory.writeMappedWord(IO_GEO_CTRL, GEO_CTRL_ABORT);
			advance(13);
			requireUnpublished(memory);
			require(memory.readIoU32(IO_GEO_STATUS) == (GEO_STATUS_DONE | GEO_STATUS_ERROR)
				&& (memory.readIoU32(IO_GEO_FAULT) >> GEO_FAULT_CODE_SHIFT) == GEO_FAULT_ABORTED,
				"ABORT discards an unpublished contact without rolling back earlier writes");
		} else {
			advance(12);
			requireUnpublished(memory);
			advance(1);
			require(memory.readU32(result + GEO_OVERLAP2D_RESULT_NY_OFFSET) == 0xbf800000u
				&& memory.readU32(result + GEO_OVERLAP2D_RESULT_DEPTH_OFFSET) == 0x40400000u,
				"the paid publication retains its exact contact bits");
			require(memory.readIoU32(IO_GEO_PROCESSED) == 1u && memory.readU32(summary) == 1u,
				"one outer record completes after its contact and summary publish");
			require(controller.captureState().pendingCycles == 9, "the final outer record pays five read and four summary words");
			advance(9);
			require(memory.readIoU32(IO_GEO_STATUS) == GEO_STATUS_DONE && memory.readIoU32(IO_GEO_PROCESSED) == 2u,
				"DONE waits for the final paid output boundary");
			require((memory.readMappedWord(IO_IRQ_FLAGS) & IRQ_GEO_DONE) != 0u, "the completion IRQ follows the output deadline");
		}
	}

}
