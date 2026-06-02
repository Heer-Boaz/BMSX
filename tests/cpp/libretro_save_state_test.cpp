#include "core/console.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/registers.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "platform.h"
#include "support/program_cart_fixture.h"

#include <array>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void discardRetroLog(enum retro_log_level, const char*, ...) {
}

void testLibretroSaveStateRoundTrip() {
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software);
	platform.setLogCallback(discardRetroLog);
	require(platform.getStateSize() == 0u, "libretro state size should be zero before a ROM is loaded");

	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load and boot a program cart ROM");
	require(platform.console()->romLoaded(), "ConsoleCore should mark the cart ROM loaded");
	require(platform.console()->hasRuntime(), "ConsoleCore should own a runtime after cart boot");

	bmsx::Runtime& runtime = platform.console()->runtime();
	require(runtime.isInitialized(), "cart program boot should initialize the runtime");
	const size_t stateSize = platform.getStateSize();
	require(stateSize > 0u, "libretro state size should come from initialized runtime state");

	bmsx::Memory& memory = runtime.machine.memory;
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0x11223344u);
	memory.writeMappedU32LE(bmsx::IO_VDP_REG_BG_COLOR, 0xff112233u);
	runtime.machine.irqController.raise(bmsx::IRQ_VBLANK);
	require(platform.getStateSize() == stateSize, "libretro state size should remain stable across RAM and device-register changes");

	std::vector<bmsx::u8> saved(stateSize);
	require(platform.saveState(saved.data(), saved.size()), "libretro saveState should serialize initialized runtime state");

	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0xaabbccddu);
	memory.writeMappedU32LE(bmsx::IO_VDP_REG_BG_COLOR, 0xff445566u);
	runtime.machine.irqController.reset();
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0xaabbccddu, "RAM mutation should be visible before loadState");
	require(memory.readIoU32(bmsx::IO_VDP_REG_BG_COLOR) == 0xff445566u, "VDP register mutation should be visible before loadState");
	require(!runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "IRQ reset should clear the maskable line before loadState");

	require(platform.loadState(saved.data(), stateSize), "libretro loadState should apply runtime state bytes");
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x11223344u, "libretro loadState should restore RAM through Runtime save state");
	require(memory.readIoU32(bmsx::IO_VDP_REG_BG_COLOR) == 0xff112233u, "libretro loadState should restore VDP raw registerfile state");
	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "libretro loadState should restore asserted IRQ line state");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "libretro loadState should restore cart-visible IRQ flags");

	constexpr uint32_t rpuHeader = 0x18000000u;
	constexpr uint32_t resourceNone = 0xffffffffu;
	constexpr uint32_t opBeginPass = 32u;
	constexpr uint32_t opEndPass = 33u;
	constexpr uint32_t opBeginDraw = 40u;
	constexpr uint32_t opEndDraw = 44u;
	constexpr uint32_t shaderV2C4 = 0u;
	constexpr uint32_t primitiveTriangles = 0u;
	constexpr uint32_t indexNone = 0u;
	constexpr uint32_t pipeColorWriteRgba = 0x000f0000u;
	const uint32_t rpuWords[] = {
		rpuHeader | (8u << 16u), opBeginPass, resourceNone, resourceNone, 0u, 256u | (212u << 16u), 1u, 0xff112233u, 0xffffffffu,
		rpuHeader | (9u << 16u), opBeginDraw, shaderV2C4, primitiveTriangles | (indexNone << 8u), pipeColorWriteRgba, 3u, 1u, resourceNone, 0u, 0u,
		rpuHeader | (1u << 16u), opEndDraw,
		rpuHeader | (1u << 16u), opEndPass,
		bmsx::VDP_PKT_END,
	};
	for (const uint32_t word : rpuWords) {
		memory.writeMappedU32LE(bmsx::IO_VDP_FIFO, word);
	}
	memory.writeMappedU32LE(bmsx::IO_VDP_FIFO_CTRL, bmsx::VDP_FIFO_CTRL_SEAL);
	require(memory.readIoU32(bmsx::IO_VDP_FAULT_CODE) == bmsx::VDP_FAULT_NONE, "restored VDP should accept RPU packets after libretro loadState");
	runtime.machine.vdp.advanceWork(runtime.machine.vdp.getPendingRenderWorkUnits());
	require(!runtime.machine.vdp.presentReadyFrameOnVblankEdge(), "RPU frame should not use legacy framebuffer presentation after libretro loadState");
	const bmsx::VdpDeviceOutput& output = runtime.machine.vdp.readDeviceOutput();
	require(output.rpu->commands.passCount == 1u, "restored runtime should publish retained RPU pass output");
	require(output.rpu->commands.drawCount == 1u, "restored runtime should publish retained RPU draw output");
	require(output.rpu->commands.passClearColor[0u] == 0xff112233u, "restored runtime should retain RPU clear constants");
}

void testInputInitializeInstallsBaseContext() {
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software);
	platform.setLogCallback(discardRetroLog);

	bmsx::Input& input = bmsx::Input::instance();
	bmsx::PlayerInput* const playerOne = input.getPlayerInput(bmsx::Input::DEFAULT_KEYBOARD_PLAYER_INDEX);
	platform.postKeyboardEvent("KeyX", true);
	input.pollInput();
	input.samplePlayers(0.0);

	require(playerOne->checkActionTriggered("a[p]"), "Input::initialize should install host defaults as the player base context");
	require(playerOne->getActionState("a").pressed, "default base context should map keyboard KeyX to action a");
}

} // namespace

int main() {
	testLibretroSaveStateRoundTrip();
	testInputInitializeInstallsBaseContext();
	return 0;
}
