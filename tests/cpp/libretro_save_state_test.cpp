#include "core/console.h"
#include "machine/bus/io.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "platform/libretro/platform.h"
#include "support/program_cart_fixture.h"

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
	runtime.machine.irqController.raise(bmsx::IRQ_VBLANK);
	require(platform.getStateSize() == stateSize, "libretro state size should remain stable across RAM and device-register changes");

	std::vector<bmsx::u8> saved(stateSize);
	require(platform.saveState(saved.data(), saved.size()), "libretro saveState should serialize initialized runtime state");

	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0xaabbccddu);
	runtime.machine.irqController.reset();
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0xaabbccddu, "RAM mutation should be visible before loadState");
	require(!runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "IRQ reset should clear the maskable line before loadState");

	require(platform.loadState(saved.data(), stateSize), "libretro loadState should apply runtime state bytes");
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x11223344u, "libretro loadState should restore RAM through Runtime save state");
	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "libretro loadState should restore asserted IRQ line state");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "libretro loadState should restore cart-visible IRQ flags");
}

} // namespace

int main() {
	testLibretroSaveStateRoundTrip();
	return 0;
}
