#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/system/controller.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/firmware/boot_primitives.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/program/linker.h"
#include "machine/program/loader.h"
#include "machine/runtime/boot_timing.h"
#include "machine/runtime/input.h"
#include "machine/runtime/runtime.h"

#include <array>
#include <span>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class SystemResetInputSource final : public bmsx::RuntimeInputSource {
public:
	void setRuntimeInputFrameDurationMs(bmsx::f64) override {}
	void sampleInputControllerKeyWords(std::array<bmsx::u32, bmsx::INPUT_CONTROLLER_KEY_WORD_COUNT>&) override {}
	void sampleInputControllerSnapshot(bmsx::f64, bmsx::InputControllerSnapshot&) override {}
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {}
};

bmsx::ProgramImage makeReturnProgramImage() {
	bmsx::ProgramImage image;
	image.sections.text.code.resize(bmsx::INSTRUCTION_BYTES);
	bmsx::writeInstruction(
		std::span<bmsx::u8>(image.sections.text.code),
		0,
		static_cast<bmsx::u8>(bmsx::OpCode::RET),
		0,
		0,
		0
	);
	bmsx::Proto proto;
	proto.entryPC = 0;
	proto.codeLen = bmsx::INSTRUCTION_BYTES;
	proto.maxStack = 1;
	image.sections.text.protos.push_back(proto);
	return image;
}

void testResetCommandLatch() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } });
	bmsx::IrqController irq(memory);
	bmsx::CPU cpu(memory, irq);
	bmsx::SystemController controller(memory, cpu);
	controller.reset();

	memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);
	require(memory.readIoU32(bmsx::IO_SYS_CONTROL) == 0u, "system control command register is self-clearing");
	require(controller.captureState().resetRequested, "system reset command latches a reset request");

	const bmsx::SystemControllerState state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	require(controller.takeResetRequest(), "save-state restores a pending system reset");
	require(!controller.takeResetRequest(), "consuming a system reset clears the latch");
}

void testRuntimeSystemRebootBoundary() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	const bmsx::ResolvedRuntimeTiming timing = bmsx::resolveRuntimeTiming(
		bmsx::PSX_MACHINE_SPEC.cpuFreqHz,
		bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD
	);
	SystemResetInputSource input;
	bmsx::Runtime runtime(
		bmsx::RuntimeOptions{
			{ emptyRom.data(), 0u },
			{ emptyRom.data(), 0u },
			timing.gpuDisplayModeWord,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.dmaWordsPerSec,
			timing.geoWorkUnitsPerSec,
		},
		input
	);
	runtime.resetRuntimeForProgramReload();
	runtime.enterSystemFirmware();
	bmsx::ProgramImage systemImage = makeReturnProgramImage();
	for (const bmsx::LuaBootPrimitive& primitive : bmsx::LUA_BOOT_PRIMITIVES) {
		systemImage.link.symbols.systemGlobalNames.emplace_back(primitive.name);
	}
	const bmsx::ProgramImage cartImage = makeReturnProgramImage();
	runtime.bootLinkedProgramImage(bmsx::linkBootProgramImages(
		systemImage,
		nullptr,
		cartImage,
		nullptr,
		bmsx::ProgramBootTarget::System
	));

	require(runtime.isInitialized(), "linked system program initializes before the first frame");
	require(!runtime.cartProgramStarted, "linked boot begins in system firmware");
	runtime.frameScheduler.run(runtime, runtime.timing.frameDurationMs);
	require(runtime.cartProgramStarted, "system root return starts the preserved cart entry");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);
	runtime.frameScheduler.run(runtime, runtime.timing.frameDurationMs);
	require(!runtime.cartProgramStarted, "system reset restarts the system program before cart execution");
	require(!runtime.machine.systemController.captureState().resetRequested, "runtime boundary consumes the system reset latch");
	require(runtime.frameScheduler.lastTickSequence == 0, "system reset clears scheduler sequence state");
	require(runtime.isInitialized(), "system program is pending after reset");

	runtime.frameScheduler.run(runtime, runtime.timing.frameDurationMs);
	require(runtime.cartProgramStarted, "rebooted system root can hand off to the original cart entry");
}

} // namespace

int main() {
	testResetCommandLatch();
	testRuntimeSystemRebootBoundary();
	return 0;
}
