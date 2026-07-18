#include "machine/bus/io.h"
#include "machine/machine.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"

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
	void sampleInputControllerSnapshot(bmsx::f64, bmsx::InputControllerSnapshot& snapshot) override {
		fullSampleCount += 1;
		snapshot.keyWords = keyWords;
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
	int fullSampleCount = 0;
	bool supervisorRequestLine = false;
};

struct InputControllerHarness {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory;
	TestInput input;
	bmsx::Machine machine;

	InputControllerHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, machine(memory, input) {
		machine.resetDevices();
	}
};

void testSystemNmiEdgeDoesNotPublishAnUnarmedSnapshot() {
	InputControllerHarness harness;
	bmsx::InputController& controller = harness.machine.inputController;
	bmsx::InputControllerState restored = controller.captureState();
	restored.supervisorRequestLineHigh = true;
	controller.restoreState(restored);
	harness.input.supervisorRequestLine = true;
	controller.onVblankEdge(1.0, 1u);

	require(harness.input.fullSampleCount == 0, "unarmed VBlank does not sample the full input frame");
	require(harness.memory.readIoU32(bmsx::IO_INP_STATUS) == 0u, "unarmed VBlank leaves the sample sequence unchanged");
	require(harness.machine.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None, "a restored high request line is not a new edge");

	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_RESET);
	controller.onVblankEdge(2.0, 2u);
	require(harness.machine.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None, "guest ICU reset cannot synthesize a physical edge");

	harness.input.supervisorRequestLine = false;
	controller.onVblankEdge(3.0, 3u);
	harness.input.supervisorRequestLine = true;
	controller.onVblankEdge(4.0, 4u);
	require(harness.machine.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None, "the ICU edge waits for the common device fence");
	harness.machine.systemController.onService();
	require(harness.machine.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::NonMaskable, "the completed fence requests NMI");
	require(controller.captureState().supervisorRequestLineHigh, "save-state retains the physical edge level");
}

void testArmedVblankPublishesTheFullSnapshot() {
	constexpr bmsx::u32 f2Usage = 59u;
	InputControllerHarness harness;
	harness.input.setKey(f2Usage, true);
	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	harness.machine.inputController.onVblankEdge(1.0, 7u);

	require(harness.input.fullSampleCount == 1, "armed VBlank samples one full input frame");
	require(harness.memory.readIoU32(bmsx::IO_INP_STATUS) == 1u, "armed VBlank advances the sample sequence");
	const bmsx::u32 f2WordAddress = bmsx::IO_INP_KEYS + (f2Usage >> 5u) * bmsx::IO_WORD_SIZE;
	require((harness.memory.readIoU32(f2WordAddress) & (1u << (f2Usage & 31u))) != 0u,
		"armed VBlank publishes F2 in the raw guest bitmap");
}

} // namespace

int main() {
	testSystemNmiEdgeDoesNotPublishAnUnarmedSnapshot();
	testArmedVblankPublishesTheFullSnapshot();
	return 0;
}
