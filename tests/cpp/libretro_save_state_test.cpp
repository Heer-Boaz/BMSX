#include "core/console.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/registers.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "platform/libretro/platform.h"
#include "render/backend/backend.h"
#include "render/backend/software/vdp_framebuffer_execution.h"
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

	memory.writeMappedU32LE(bmsx::IO_VDP_CMD, bmsx::VDP_CMD_BEGIN_FRAME);
	memory.writeMappedU32LE(bmsx::IO_VDP_CMD, bmsx::VDP_CMD_CLEAR);
	memory.writeMappedU32LE(bmsx::IO_VDP_CMD, bmsx::VDP_CMD_END_FRAME);
	const int workUnits = runtime.machine.vdp.getPendingRenderWorkUnits();
	require(workUnits > 0, "restored VDP BG register should submit CLEAR work after libretro loadState");
	runtime.machine.vdp.advanceWork(workUnits);
	std::vector<uint32_t> framebuffer(256u * 212u, 0u);
	bmsx::SoftwareBackend softwareBackend(framebuffer.data(), 256, 212, 256 * static_cast<int>(sizeof(uint32_t)));
	bmsx::drainReadyVdpFrameBufferExecutionForSoftware(softwareBackend, runtime.machine.vdp);
	require(runtime.machine.vdp.presentReadyFrameOnVblankEdge(), "restored VDP state should present framebuffer output after libretro loadState");
	std::array<bmsx::u8, 4u> pixel{};
	require(runtime.machine.vdp.readFrameBufferPixels(bmsx::VdpFrameBufferPage::Display, 0u, 0u, 1u, 1u, pixel.data(), pixel.size()), "restored VDP framebuffer should be readable");
	require(pixel == std::array<bmsx::u8, 4u>{{0x11u, 0x22u, 0x33u, 0xffu}}, "restored VDP registerfile should determine visible framebuffer output");
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
