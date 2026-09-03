#include "spec/bmsx/io.h"
#include "machine/machine.h"
#include "spec/bmsx/memory_map.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class TestInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(
		bmsx::InputControllerSnapshot& snapshot,
		bmsx::InputControllerSampleContext context) override {
		sampleContexts[fullSampleCount] = context;
		fullSampleCount += 1;
		snapshot.keyWords = keyWords;
		snapshot.pointerXQ16 = 0x000c8000u;
		snapshot.pointerYQ16 = 0xfffcc000u;
		snapshot.pads[0].axesQ16[static_cast<size_t>(
			bmsx::InputControllerGamepadAxis::LeftX)] = 0xffff8000u;
	}

	auto supervisorRequestLineHigh() const -> bool override {
		return supervisorRequestLine;
	}

	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {
	}

	void setKey(bmsx::u32 usage, bool down) {
		const size_t word = usage >> 5u;
		const bmsx::u32 mask = 1u << (usage & 31u);
		if (down) {
			keyWords[word] |= mask;
		} else {
			keyWords[word] &= ~mask;
		}
	}

	std::array<bmsx::u32, bmsx::INPUT_CONTROLLER_KEY_WORD_COUNT> keyWords{};
	std::array<bmsx::InputControllerSampleContext, 2> sampleContexts{};
	int fullSampleCount = 0;
	bool supervisorRequestLine = false;
};

struct InputControllerHarness {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory;
	TestInput input;
	bmsx::Machine machine;

	InputControllerHarness()
		: memory(
			bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
			bmsx::PSX_MACHINE_SPEC.ramBytes)
		, machine(memory, input, bmsx::PSX_MACHINE_SPEC) {
		machine.resetDevices();
	}
};

void testSystemNmiEdgeDoesNotPublishAnUnarmedSnapshot() {
	InputControllerHarness harness;
	TestInput& input = harness.input;
	bmsx::CPU& cpu = harness.machine.cpu;
	bmsx::InputController& controller = harness.machine.inputController;
	constexpr bmsx::AcceptedInterruptKind noInterrupt =
		bmsx::AcceptedInterruptKind::None;
	bmsx::InputControllerState restored = controller.captureState();
	restored.supervisorRequestLineHigh = true;
	controller.restoreState(restored);
	input.supervisorRequestLine = true;
	controller.onVblankEdge(1u);

	require(input.fullSampleCount == 0, "unarmed VBlank does not sample the full input frame");
	require(harness.memory.readIoU32(bmsx::IO_INP_STATUS) == 0u, "unarmed VBlank leaves the sample sequence unchanged");
	require(cpu.peekPendingInterrupt() == noInterrupt, "a restored high request line is not a new edge");

	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_RESET);
	controller.onVblankEdge(2u);
	require(cpu.peekPendingInterrupt() == noInterrupt, "guest ICU reset cannot synthesize a physical edge");

	input.supervisorRequestLine = false;
	controller.onVblankEdge(3u);
	input.supervisorRequestLine = true;
	controller.onVblankEdge(4u);
	require(cpu.peekPendingInterrupt() == noInterrupt, "the ICU edge waits for the common device fence");
	harness.machine.systemController.onService();
	require(cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::NonMaskable, "the completed fence requests NMI");
	require(controller.captureState().supervisorRequestLineHigh, "save-state retains the physical edge level");
}

void testArmedVblankPublishesTheFullSnapshot() {
	constexpr bmsx::u32 f2Usage = 59u;
	InputControllerHarness harness;
	harness.input.setKey(f2Usage, true);
	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	harness.machine.inputController.onVblankEdge(7u);

	require(harness.input.fullSampleCount == 1, "armed VBlank samples one full input frame");
	require(
		harness.input.sampleContexts[0] == bmsx::InputControllerSampleContext::Normal,
		"initial BIOS execution uses the normal source-sampling context"
	);
	require(harness.memory.readIoU32(bmsx::IO_INP_STATUS) == 1u, "armed VBlank advances the sample sequence");
	const bmsx::u32 f2WordAddress = bmsx::IO_INP_KEYS + (f2Usage >> 5u) * bmsx::IO_WORD_SIZE;
	require((harness.memory.readIoU32(f2WordAddress) & (1u << (f2Usage & 31u))) != 0u,
		"armed VBlank publishes F2 in the raw guest bitmap");
	require(harness.memory.readIoU32(bmsx::IO_INP_POINTER_X) == 0x000c8000u,
		"armed VBlank latches the source-port pointer word directly");
	require(harness.memory.readIoU32(bmsx::IO_INP_POINTER_Y) == 0xfffcc000u,
		"armed VBlank preserves signed source-port pointer bits");
	require(harness.memory.readIoU32(bmsx::IO_INP_PADS + bmsx::IO_INP_PAD_LX_OFFSET) == 0xffff8000u,
		"armed VBlank latches the source-port axis word directly");
}

void testSupervisorPhaseSelectsTheSourceSamplingContext() {
	InputControllerHarness harness;
	harness.input.supervisorRequestLine = true;
	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	harness.machine.inputController.onVblankEdge(1u);
	require(
		harness.input.sampleContexts[0] == bmsx::InputControllerSampleContext::Normal,
		"the request edge samples before entering the supervisor transition"
	);
	require(
		harness.machine.systemController.supervisorContextActive(),
		"the physical edge starts the retained supervisor transition"
	);

	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	harness.machine.inputController.onVblankEdge(2u);
	require(
		harness.input.sampleContexts[1] == bmsx::InputControllerSampleContext::Supervisor,
		"the active transition selects the supervisor source-sampling context"
	);
}

} // namespace

int main() {
	testSystemNmiEdgeDoesNotPublishAnUnarmedSnapshot();
	testArmedVblankPublishesTheFullSnapshot();
	testSupervisorPhaseSelectsTheSourceSamplingContext();
	return 0;
}
