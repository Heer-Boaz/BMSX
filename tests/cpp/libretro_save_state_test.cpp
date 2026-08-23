#include "hid_keys.h"
#include "input.h"
#include "libretro_state.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/input/contracts.h"
#include "machine/runtime/runtime.h"
#include "rompack/image.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/boot_rom_fixture.h"

#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void discardInputPoll() {
}

bool supervisorRequestLineHigh = false;

bool RETRO_CALLCONV readSupervisorRequestLine() {
	return supervisorRequestLineHigh;
}

std::array<uint16_t, bmsx::INPUT_CONTROLLER_PAD_COUNT> gamepadStates{};
int16_t pointerX = 0;
int16_t pointerY = 0;
bool pointerPressed = false;

int16_t hostInputState(unsigned port, unsigned device, unsigned, unsigned id) {
	if (device == RETRO_DEVICE_JOYPAD) {
		return (gamepadStates[port] & (1u << id)) != 0u ? 1 : 0;
	}
	if (port == 0u && device == RETRO_DEVICE_POINTER) {
		switch (id) {
			case 0u: return pointerX;
			case 1u: return pointerY;
			case 2u: return pointerPressed ? 1 : 0;
			default: return 0;
		}
	}
	return 0;
}

void testLibretroStateEnvelopeRoundTrip() {
	bmsx::LibretroInput input(readSupervisorRequestLine);
	const std::vector<bmsx::u8> system =
		bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System);
	const std::vector<bmsx::u8> cartridge = bmsx::test::makeMinimalBootRom(
		bmsx::RomImageDomain::Cartridge,
		bmsx::CARTRIDGE_BOARD_RAM,
		16u);
	const bmsx::RomImage systemImage = bmsx::parseRomImage(
		system.data(),
		system.size(),
		bmsx::RomImageDomain::System);
	const bmsx::RomImage cartridgeImage = bmsx::parseRomImage(
		cartridge.data(),
		cartridge.size(),
		bmsx::RomImageDomain::Cartridge);
	const bmsx::CartridgeSlotMediaPair cartridgeMedia{{
		{
			cartridgeImage.bytes,
			cartridgeImage.header.cartridgeBoardWord,
			cartridgeImage.header.cartridgeRamByteCount,
			true,
		},
		{},
	}};
	bmsx::Runtime runtime(
		bmsx::RuntimeOptions{
			systemImage.bytes,
			cartridgeMedia,
			bmsx::PSX_MACHINE_SPEC,
		},
		input);
	runtime.resetForSystemBoot();
	runtime.boot();

	bmsx::Memory& memory = runtime.machine.memory;
	const size_t stateSize = bmsx::libretroStateSize(runtime);
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0x11223344u);
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0x89abcdefu);
	std::vector<bmsx::u8> envelope(stateSize + 16u);
	require(
		bmsx::serializeLibretroState(runtime, envelope),
		"libretro envelope should serialize into a caller buffer larger than its fixed size");
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0xaabbccddu);
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0u);
	require(
		bmsx::unserializeLibretroState(runtime, envelope),
		"libretro envelope should decode its retained payload length");
	require(
		memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x11223344u,
		"libretro envelope should restore system RAM");
	require(
		memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0x89abcdefu,
		"libretro envelope should restore cartridge RAM");

	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	for (bmsx::u32 parameter = 0u; parameter < 2u; ++parameter) {
		gpu.writeGp0(0u);
	}
	gpu.onService(runtime.machine.scheduler.currentNowCycles() + 1);
	gpu.presentReadyFrameOnVblankEdge();
	require(
		bmsx::libretroStateSize(runtime) == stateSize,
		"libretro envelope size should remain fixed with maximum READY GPUREAD data");
	require(
		bmsx::serializeLibretroState(runtime, envelope),
		"libretro envelope should contain maximum READY GPUREAD data");
	require(
		bmsx::unserializeLibretroState(runtime, envelope),
		"libretro envelope should restore maximum READY GPUREAD data");
}

void testInputSnapshotReflectsHeldKey() {
	bmsx::LibretroInput input(readSupervisorRequestLine);
	input.setInputPollCallback(discardInputPoll);
	input.setInputStateCallback(hostInputState);
	input.postKeyboardEvent(RETROK_x, true);
	input.poll(256, 240, 0.0);
	bmsx::InputControllerSnapshot snapshot;
	input.sampleInputControllerSnapshot(snapshot);

	constexpr uint32_t usage = bmsx::hid_key_usage::X;
	require(
		(snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u,
		"raw ICU snapshot should set the keyboard bit for a held key");

	input.setVirtualKeyboardKey(bmsx::hid_key_usage::X, true);
	input.postKeyboardEvent(RETROK_x, false);
	input.poll(256, 240, 1.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u,
		"virtual and physical keyboard sources must retain independent ownership");

	input.setVirtualKeyboardKey(bmsx::hid_key_usage::X, false);
	input.poll(256, 240, 2.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) == 0u,
		"releasing the final keyboard source should clear the ICU key bit");
}

void testHostPointerConsumptionMasksGuestSnapshot() {
	bmsx::LibretroInput input(readSupervisorRequestLine);
	input.setInputPollCallback(discardInputPoll);
	input.setInputStateCallback(hostInputState);
	pointerX = 16384;
	pointerY = -16384;
	pointerPressed = true;
	input.poll(256, 240, 0.0);

	bmsx::i32 x = 0;
	bmsx::i32 y = 0;
	require(
		input.pointerPosition(x, y),
		"a libretro pointer press should publish a viewport position");
	require(
		x == 191 && y == 60,
		"libretro pointer coordinates should map directly into the retained viewport");
	require(
		input.pointerButtonPressed(bmsx::INP_POINTER_BUTTON_PRIMARY),
		"the host overlay should observe the physical primary pointer button");

	input.consumePointerButton(bmsx::INP_POINTER_BUTTON_PRIMARY);
	bmsx::InputControllerSnapshot snapshot;
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pointerButtons
			& (1u << bmsx::INP_POINTER_BUTTON_PRIMARY)) == 0u,
		"a host-owned pointer press must not leak into the ICU snapshot");
	require(
		input.pointerButtonPressed(bmsx::INP_POINTER_BUTTON_PRIMARY),
		"routing consumption must not mutate the physical pointer source");

	input.poll(256, 240, 1.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pointerButtons
			& (1u << bmsx::INP_POINTER_BUTTON_PRIMARY)) != 0u,
		"each input poll should republish unconsumed physical pointer state");
	pointerX = 0;
	pointerY = 0;
	pointerPressed = false;
}

void testLibretroSupervisorRequestChordAndGuestInput() {
	supervisorRequestLineHigh = false;
	gamepadStates.fill(0u);
	bmsx::LibretroInput input(readSupervisorRequestLine);
	input.setInputPollCallback(discardInputPoll);
	input.setInputStateCallback(hostInputState);

	const uint32_t leftShoulderButton = 1u << static_cast<uint32_t>(
		bmsx::InputControllerGamepadButtonBit::LeftBumper);
	constexpr bmsx::InputControllerGamepadButtonBit quickMenuButton =
		bmsx::InputControllerGamepadButtonBit::Start;
	const uint32_t selectButton = 1u << static_cast<uint32_t>(
		bmsx::InputControllerGamepadButtonBit::Select);
	const uint32_t supervisorChordButtons = leftShoulderButton | selectButton;
	bmsx::InputControllerSnapshot snapshot;

	gamepadStates[0] = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"the reserved modifier alone must not assert the supervisor line");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[0].buttons & selectButton) == 0u,
		"the reserved modifier must be masked before command selection");

	gamepadStates[0] |= 1u << RETRO_DEVICE_ID_JOYPAD_L;
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"a completed RetroPad supervisor chord must assert the host line");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[0].buttons & supervisorChordButtons) == 0u,
		"a completed supervisor chord must be masked from cart input");

	gamepadStates[0] = 1u << RETRO_DEVICE_ID_JOYPAD_L;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"releasing the modifier must lower the supervisor line");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[0].buttons & supervisorChordButtons) == 0u,
		"the command target must remain masked until release");

	gamepadStates[0] = 0u;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"full release must rearm the core-owned shortcut");

	supervisorRequestLineHigh = true;
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"the negotiated host line should assert the supervisor request");
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"a held host line should remain asserted");

	input.postKeyboardEvent(RETROK_F2, true);
	supervisorRequestLineHigh = false;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"a cart-visible F2 press must not assert the supervisor-request line");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[bmsx::hid_key_usage::F2 >> 5u]
			& (1u << (bmsx::hid_key_usage::F2 & 31u))) != 0u,
		"libretro F2 must remain an ordinary cart-visible HID key");

	supervisorRequestLineHigh = true;
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"the negotiated host line should remain independent of held guest keys");

	input.postKeyboardEvent(RETROK_F2, false);
	input.poll(256, 240, 0.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[bmsx::hid_key_usage::F2 >> 5u]
			& (1u << (bmsx::hid_key_usage::F2 & 31u))) == 0u,
		"releasing libretro F2 must clear its ordinary HID key");
	require(
		input.supervisorRequestLineHigh(),
		"guest key release must not lower the negotiated host line");
	supervisorRequestLineHigh = false;
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"lowering the negotiated host line should deassert the supervisor request");

	input.postKeyboardEvent(RETROK_RCTRL, true);
	input.poll(256, 240, 0.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[bmsx::hid_key_usage::ControlRight >> 5u]
			& (1u << (bmsx::hid_key_usage::ControlRight & 31u))) == 0u,
		"keyboard Select must be reserved before a host command is selected");
	input.postKeyboardEvent(RETROK_LSHIFT, true);
	input.poll(256, 240, 0.0);
	require(
		input.supervisorRequestLineHigh(),
		"keyboard Select plus L1 must assert the supervisor line across frames");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[bmsx::hid_key_usage::ShiftLeft >> 5u]
			& (1u << (bmsx::hid_key_usage::ShiftLeft & 31u))) == 0u,
		"an active keyboard host command must be masked from the guest");
	input.postKeyboardEvent(RETROK_RCTRL, false);
	input.poll(256, 240, 0.0);
	require(
		!input.supervisorRequestLineHigh(),
		"releasing keyboard Select must lower the supervisor line");
	input.postKeyboardEvent(RETROK_LSHIFT, false);
	input.poll(256, 240, 0.0);

	input.postKeyboardEvent(RETROK_RCTRL, true);
	input.postKeyboardEvent(RETROK_RALT, true);
	input.poll(256, 240, 0.0);
	require(
		input.hostShortcutJustPressed(quickMenuButton),
		"keyboard Select plus Start must publish one quick-menu activation edge");
	input.poll(256, 240, 0.0);
	require(
		!input.hostShortcutJustPressed(quickMenuButton),
		"a held quick-menu shortcut must not retrigger");
	input.postKeyboardEvent(RETROK_RCTRL, false);
	input.postKeyboardEvent(RETROK_RALT, false);
	input.poll(256, 240, 0.0);

	input.postKeyboardEvent(RETROK_BACKSPACE, true);
	input.postKeyboardEvent(RETROK_RETURN, true);
	input.poll(256, 240, 0.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.keyWords[bmsx::hid_key_usage::Backspace >> 5u]
			& (1u << (bmsx::hid_key_usage::Backspace & 31u))) != 0u &&
		(snapshot.keyWords[bmsx::hid_key_usage::Enter >> 5u]
			& (1u << (bmsx::hid_key_usage::Enter & 31u))) != 0u,
		"Backspace and Enter must remain ordinary keyboard input");
	input.postKeyboardEvent(RETROK_BACKSPACE, false);
	input.postKeyboardEvent(RETROK_RETURN, false);

	const uint32_t startButton = 1u << static_cast<uint32_t>(
		quickMenuButton);
	const uint32_t rightButton = 1u << static_cast<uint32_t>(
		bmsx::InputControllerGamepadButtonBit::Right);

	gamepadStates[1] = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT;
	input.poll(256, 240, 0.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[1].buttons & selectButton) == 0u,
		"every libretro port must reserve the host shortcut modifier");

	gamepadStates[1] |= 1u << RETRO_DEVICE_ID_JOYPAD_START;
	input.poll(256, 240, 1.0);
	require(
		input.hostShortcutJustPressed(quickMenuButton),
		"a non-primary libretro port must publish the quick-menu activation edge");
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[1].buttons & (selectButton | startButton)) == 0u,
		"a non-primary host shortcut chord must remain hidden from the cart");

	gamepadStates[1] = 0u;
	input.poll(256, 240, 2.0);
	gamepadStates[1] = 1u << RETRO_DEVICE_ID_JOYPAD_RIGHT;
	input.poll(256, 240, 3.0);
	input.sampleInputControllerSnapshot(snapshot);
	require(
		(snapshot.pads[1].buttons & rightButton) != 0u
			&& snapshot.pads[0].buttons == 0u,
		"ordinary input must retain its libretro port after host shortcut routing");
	gamepadStates.fill(0u);
}

} // namespace

int main() {
	testLibretroStateEnvelopeRoundTrip();
	testInputSnapshotReflectsHeldKey();
	testHostPointerConsumptionMasksGuestSnapshot();
	testLibretroSupervisorRequestChordAndGuestInput();
	return 0;
}
