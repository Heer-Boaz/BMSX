#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/irq/controller.h"
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
	void sampleInputControllerKeyWords(std::array<bmsx::u32, bmsx::INPUT_CONTROLLER_KEY_WORD_COUNT>& out) override {
		keySampleCount += 1;
		out = keyWords;
	}

	void sampleInputControllerSnapshot(bmsx::f64, bmsx::InputControllerSnapshot& snapshot) override {
		fullSampleCount += 1;
		snapshot.keyWords = keyWords;
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
	int keySampleCount = 0;
	int fullSampleCount = 0;
};

struct InputControllerHarness {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	TestInput input;
	bmsx::InputController controller;

	InputControllerHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, irq(memory)
		, cpu(memory, irq)
		, controller(memory, input, cpu) {
		irq.reset();
		controller.reset();
	}
};

void testSystemNmiEdgeDoesNotPublishAnUnarmedSnapshot() {
	InputControllerHarness harness;
	bmsx::InputControllerState restored = harness.controller.captureState();
	restored.systemNmiLineHigh = true;
	harness.controller.restoreState(restored);
	harness.input.setKey(bmsx::INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE, true);
	harness.controller.onVblankEdge(1.0, 1u);

	require(harness.input.fullSampleCount == 0, "unarmed VBlank does not sample the full input frame");
	require(harness.input.keySampleCount == 1, "unarmed VBlank samples the raw keyboard matrix");
	require(harness.memory.readIoU32(bmsx::IO_INP_STATUS) == 0u, "unarmed VBlank leaves the sample sequence unchanged");
	const bmsx::u32 f2WordAddress = bmsx::IO_INP_KEYS
		+ (bmsx::INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE >> 5u) * bmsx::IO_WORD_SIZE;
	require(harness.memory.readIoU32(f2WordAddress) == 0u, "unarmed system-key sampling stays outside the guest latch");
	require(harness.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None, "a restored held key is not a new edge");

	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_RESET);
	harness.controller.onVblankEdge(2.0, 2u);
	require(harness.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None, "guest ICU reset cannot synthesize a physical edge");

	harness.input.setKey(bmsx::INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE, false);
	harness.controller.onVblankEdge(3.0, 3u);
	harness.input.setKey(bmsx::INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE, true);
	harness.controller.onVblankEdge(4.0, 4u);
	require(harness.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::NonMaskable, "a new F2 rising edge requests NMI");
	require(harness.controller.captureState().systemNmiLineHigh, "save-state retains the physical edge level");
}

void testArmedVblankPublishesTheFullSnapshot() {
	InputControllerHarness harness;
	harness.input.setKey(bmsx::INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE, true);
	harness.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	harness.controller.onVblankEdge(1.0, 7u);

	require(harness.input.fullSampleCount == 1, "armed VBlank samples one full input frame");
	require(harness.input.keySampleCount == 0, "armed VBlank does not perform a second keyboard scan");
	require(harness.memory.readIoU32(bmsx::IO_INP_STATUS) == 1u, "armed VBlank advances the sample sequence");
	const bmsx::u32 f2WordAddress = bmsx::IO_INP_KEYS
		+ (bmsx::INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE >> 5u) * bmsx::IO_WORD_SIZE;
	require((harness.memory.readIoU32(f2WordAddress) & (1u << (bmsx::INPUT_CONTROLLER_SYSTEM_NMI_HID_USAGE & 31u))) != 0u,
		"armed VBlank publishes F2 in the raw guest bitmap");
}

} // namespace

int main() {
	testSystemNmiEdgeDoesNotPublishAnUnarmedSnapshot();
	testArmedVblankPublishesTheFullSnapshot();
	return 0;
}
