#include "input.h"

#include <array>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
using namespace bmsx;

struct PointerSample {
	i16 x;
	i16 y;
};

std::vector<PointerSample> contacts;
std::array<i16, 11> mouse{};
std::array<u16, INPUT_CONTROLLER_PAD_COUNT> joypads{};
size_t pressedQueries = 0;
size_t coordinateQueries = 0;

void poll() {}
bool RETRO_CALLCONV supervisor() { return false; }
i16 state(unsigned port, unsigned device, unsigned index, unsigned id) {
	if (device == RETRO_DEVICE_JOYPAD) return (joypads[port] & (1u << id)) != 0u;
	if (port != 0u) return 0;
	if (device == RETRO_DEVICE_MOUSE) return mouse[id];
	if (device == RETRO_DEVICE_POINTER) {
		if (id == RETRO_DEVICE_ID_POINTER_PRESSED) {
			++pressedQueries;
			return index < contacts.size() ? 1 : 0;
		}
		++coordinateQueries;
		// Frontends may retain arbitrary coordinates after the press ends.
		if (index >= contacts.size()) return 16000;
		return id == RETRO_DEVICE_ID_POINTER_X ? contacts[index].x : contacts[index].y;
	}
	return 0;
}

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct InputFixture {
	LibretroInput input{supervisor};
	f64 time = 0;
	InputFixture() {
		contacts.clear();
		mouse.fill(0);
		joypads.fill(0);
		input.setInputPollCallback(poll);
		input.setInputStateCallback(state);
	}
	void tick() {
		pressedQueries = coordinateQueries = 0;
		input.poll(320, 240, time);
		time += 20;
	}
};

void testRetroPadPositionsUseCanonicalGamepadBits() {
	InputFixture fixture;
	constexpr std::array expected{
		InputControllerGamepadButtonBit::A, InputControllerGamepadButtonBit::X,
		InputControllerGamepadButtonBit::Select, InputControllerGamepadButtonBit::Start,
		InputControllerGamepadButtonBit::Up, InputControllerGamepadButtonBit::Down,
		InputControllerGamepadButtonBit::Left, InputControllerGamepadButtonBit::Right,
		InputControllerGamepadButtonBit::B, InputControllerGamepadButtonBit::Y,
		InputControllerGamepadButtonBit::LeftBumper, InputControllerGamepadButtonBit::RightBumper,
		InputControllerGamepadButtonBit::LeftTrigger, InputControllerGamepadButtonBit::RightTrigger,
		InputControllerGamepadButtonBit::LeftStick, InputControllerGamepadButtonBit::RightStick,
	};
	for (u8 player = 0; player < INPUT_CONTROLLER_PAD_COUNT; ++player) {
		for (unsigned retro = 0; retro < expected.size(); ++retro) {
			joypads[player] = 1u << retro;
			fixture.tick();
			const u32 canonical = 1u << static_cast<u32>(expected[retro]);
			require(fixture.input.physicalGamepadButtonsWord(player) == canonical,
				"every RetroPad position maps to its canonical BMSX position on every port");
			InputControllerSnapshot snapshot{};
			fixture.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
			const u32 routed = retro == RETRO_DEVICE_ID_JOYPAD_SELECT ? 0u : canonical;
			require(snapshot.pads[player].buttons == routed,
				"ordinary positional buttons reach the guest unchanged while Select remains the host modifier");
			joypads[player] = 0;
			fixture.tick();
		}
	}
}

void testGamepadHostTargetsKeepTheirRealReleaseLifetime() {
	struct Shortcut {
		unsigned retro;
		InputControllerGamepadButtonBit canonical;
	};
	constexpr std::array shortcuts{
		Shortcut{RETRO_DEVICE_ID_JOYPAD_B, InputControllerGamepadButtonBit::A},
		Shortcut{RETRO_DEVICE_ID_JOYPAD_Y, InputControllerGamepadButtonBit::X},
		Shortcut{RETRO_DEVICE_ID_JOYPAD_START, InputControllerGamepadButtonBit::Start},
		Shortcut{RETRO_DEVICE_ID_JOYPAD_L, InputControllerGamepadButtonBit::LeftBumper},
	};
	for (u8 player = 0; player < INPUT_CONTROLLER_PAD_COUNT; ++player) {
		for (const auto& shortcut : shortcuts) {
			InputFixture fixture;
			joypads[player] = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << shortcut.retro);
			fixture.tick();
			require(fixture.input.hostShortcutJustPressed(shortcut.canonical),
				"Select plus bottom, west, Start or LB activates its canonical host target");
			require(!fixture.input.gamepadButtonPressed(player, shortcut.canonical)
				&& !fixture.input.gamepadButtonPressed(player, InputControllerGamepadButtonBit::Select),
				"the host chord is absent from routed guest gamepad input");
			require(fixture.input.supervisorRequestLineHigh()
				== (shortcut.canonical == InputControllerGamepadButtonBit::LeftBumper),
				"only the terminal host target raises the supervisor request line");
			fixture.tick();
			require(!fixture.input.hostShortcutJustPressed(shortcut.canonical),
				"a held chord does not repeat the host activation");
			joypads[player] = 1u << shortcut.retro;
			fixture.tick();
			require(!fixture.input.gamepadButtonPressed(player, shortcut.canonical)
				&& !fixture.input.hostShortcutJustPressed(shortcut.canonical)
				&& !fixture.input.supervisorRequestLineHigh(),
				"releasing Select leaves the captured target hidden until its actual up");
			joypads[player] = 0;
			fixture.tick();
			joypads[player] = 1u << shortcut.retro;
			fixture.tick();
			require(fixture.input.gamepadButtonPressed(player, shortcut.canonical),
				"a fresh unmodified button becomes guest input after real release");
		}
	}
}

void testKeyboardContextAllowsMultipleHostTargetsAndLocalCommands() {
	InputFixture fixture;
	constexpr u32 keyboardTargets = HOST_GAMEPAD_SHORTCUT_TARGETS
		& ~(1u << static_cast<u32>(InputControllerGamepadButtonBit::LeftBumper));
	joypads[0] = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_Y);
	fixture.tick();
	require(fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::X), "west opens the keyboard");
	fixture.input.setGamepadHostShortcutTargets(keyboardTargets);
	fixture.tick();
	require(!fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::X),
		"entering the keyboard context blocks its still-held opening chord");
	joypads[0] = 0;
	fixture.tick();
	joypads[0] = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_L)
		| (1u << RETRO_DEVICE_ID_JOYPAD_R) | (1u << RETRO_DEVICE_ID_JOYPAD_X);
	fixture.tick();
	constexpr u32 localCommands = (1u << static_cast<u32>(InputControllerGamepadButtonBit::LeftBumper))
		| (1u << static_cast<u32>(InputControllerGamepadButtonBit::RightBumper))
		| (1u << static_cast<u32>(InputControllerGamepadButtonBit::Y));
	InputControllerSnapshot snapshot{};
	fixture.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	require(snapshot.pads[0].buttons == localCommands && !fixture.input.supervisorRequestLineHigh(),
		"Select plus LB, RB and north remains available for local keyboard commands, not terminal capture");
	require((fixture.input.physicalGamepadButtonsWord(0)
		& (1u << static_cast<u32>(InputControllerGamepadButtonBit::Select))) != 0u,
		"the local keyboard owner still sees the real physical modifier");
	fixture.input.setGamepadHostShortcutTargets(HOST_GAMEPAD_SHORTCUT_TARGETS);
	fixture.tick();
	require(!fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::LeftBumper)
		&& !fixture.input.supervisorRequestLineHigh(),
		"restoring global targets cannot activate the already held local shoulder command");
	joypads[0] = 0;
	fixture.tick();
	joypads[0] = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_L);
	fixture.tick();
	require(fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::LeftBumper),
		"the restored shoulder host command rearms after real up");
	joypads[0] = 0;
	fixture.tick();
	fixture.input.setGamepadHostShortcutTargets(keyboardTargets);
	joypads[0] = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_B)
		| (1u << RETRO_DEVICE_ID_JOYPAD_START);
	fixture.tick();
	require(fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::A)
		&& fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::Start),
		"the keyboard context permits rewind and menu simultaneously instead of one exclusive target");
	joypads[0] = 0;
	fixture.tick();
	joypads[0] = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_Y);
	fixture.tick();
	require(fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::X),
		"a fresh west chord can still close the keyboard in its own context");
	fixture.input.reset();
	joypads[0] = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_L);
	fixture.tick();
	require(fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::LeftBumper),
		"reset restores the complete default gamepad host-target policy");
}

void testOrdinaryHardwareXAndZCannotBecomeGamepadHostShortcuts() {
	constexpr u32 ordinaryKeys = (1u << hid_key_usage::X) | (1u << hid_key_usage::Z);
	for (bool modifierFirst : std::array{false, true}) {
		for (u32 targets : std::array{HOST_GAMEPAD_SHORTCUT_TARGETS,
			HOST_GAMEPAD_SHORTCUT_TARGETS & ~(1u << static_cast<u32>(InputControllerGamepadButtonBit::LeftBumper))}) {
			InputFixture fixture;
			fixture.input.setGamepadHostShortcutTargets(targets);
			if (modifierFirst) { fixture.input.postKeyboardEvent(RETROK_RCTRL, true); fixture.tick(); }
			fixture.input.postKeyboardEvent(RETROK_x, true);
			fixture.input.postKeyboardEvent(RETROK_z, true);
			fixture.tick();
			if (!modifierFirst) { fixture.input.postKeyboardEvent(RETROK_RCTRL, true); fixture.tick(); }
			InputControllerSnapshot snapshot{};
			fixture.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
			require(snapshot.keyWords[0] == ordinaryKeys,
				"physical CtrlRight plus X/Z leaves both ordinary HID keys routed to the guest");
			require(!fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::A)
				&& !fixture.input.hostShortcutJustPressed(InputControllerGamepadButtonBit::X),
				"hardware X/Z is not an invented rewind or onscreen-keyboard shortcut");
			require(fixture.input.physicalOrdinaryHeldCount() == 2
				&& fixture.input.physicalOrdinaryPressGeneration() == 2,
				"host routing does not change the physical ordinary-key source accounting");
			fixture.input.postKeyboardEvent(RETROK_RCTRL, false);
			fixture.tick();
			fixture.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
			require(snapshot.keyWords[0] == ordinaryKeys, "releasing the host modifier cannot alter held ordinary X/Z");
		}
	}
}

void testHardwareTerminalAndMenuChordsRemainIndependentOfGamepadContext() {
	struct Shortcut {
		unsigned retro;
		u8 usage;
		InputControllerGamepadButtonBit target;
	};
	constexpr std::array shortcuts{
		Shortcut{RETROK_LSHIFT, hid_key_usage::ShiftLeft, InputControllerGamepadButtonBit::LeftBumper},
		Shortcut{RETROK_RALT, hid_key_usage::AltRight, InputControllerGamepadButtonBit::Start},
	};
	for (const auto& shortcut : shortcuts) {
		InputFixture fixture;
		fixture.input.setGamepadHostShortcutTargets(HOST_GAMEPAD_SHORTCUT_TARGETS
			& ~(1u << static_cast<u32>(InputControllerGamepadButtonBit::LeftBumper)));
		fixture.input.postKeyboardEvent(RETROK_RCTRL, true);
		fixture.input.postKeyboardEvent(shortcut.retro, true);
		fixture.tick();
		require(fixture.input.hostShortcutJustPressed(shortcut.target),
			"existing hardware CtrlRight terminal/menu chords remain enabled in the keyboard context");
		require(fixture.input.supervisorRequestLineHigh()
			== (shortcut.target == InputControllerGamepadButtonBit::LeftBumper),
			"only hardware CtrlRight+ShiftLeft requests the terminal supervisor line");
		fixture.input.setGamepadHostShortcutTargets(HOST_GAMEPAD_SHORTCUT_TARGETS);
		fixture.tick();
		require(!fixture.input.hostShortcutJustPressed(shortcut.target),
			"gamepad-context changes do not retarget or repeat a held hardware chord");
		fixture.input.postKeyboardEvent(RETROK_RCTRL, false);
		fixture.tick();
		InputControllerSnapshot snapshot{};
		fixture.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		require((snapshot.keyWords[shortcut.usage >> 5] & (1u << (shortcut.usage & 31u))) == 0u,
			"the hardware command key retains its capture after modifier up until its real release");
		require(fixture.input.physicalKeyboardUsagePressed(shortcut.usage),
			"the hardware source remains truthful while its guest contribution is captured");
		fixture.input.postKeyboardEvent(shortcut.retro, false);
		fixture.tick();
		fixture.input.postKeyboardEvent(shortcut.retro, true);
		fixture.tick();
		fixture.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		require((snapshot.keyWords[shortcut.usage >> 5] & (1u << (shortcut.usage & 31u))) != 0u,
			"the hardware command key becomes ordinary input after actual release");
	}
}

void testReleasedPointerCoordinatesCannotCaptureMouse() {
	InputFixture fixture;
	i32 x = 0, y = 0;
	fixture.tick();
	require(!fixture.input.pointerPosition(x, y), "released pointer coordinates do not create a pointer position");
	require(coordinateQueries == 0 && pressedQueries == 1, "coordinates are queried only for pressed contacts");
	contacts = {{16000, 12000}};
	fixture.tick();
	require(fixture.input.pointerPosition(x, y) && x == 237 && y == 163, "a pressed absolute contact maps into the viewport");
	contacts.clear();
	mouse[RETRO_DEVICE_ID_MOUSE_X] = 12;
	fixture.tick();
	require(fixture.input.pointerPosition(x, y) && x == 249 && y == 163, "released stale touch coordinates cannot suppress a mouse delta");
	require(coordinateQueries == 0 && fixture.input.pointerContacts().empty(), "released coordinates are not published as contacts");
	mouse[RETRO_DEVICE_ID_MOUSE_X] = 0;
	fixture.tick();
	require(fixture.input.pointerPosition(x, y) && x == 249 && y == 163, "an idle poll retains the guest cursor without a synthetic movement");
	require(!fixture.input.pointerButtonPressed(INP_POINTER_BUTTON_PRIMARY), "a released pointer does not keep the guest primary button held");
}

void testIndexedSnapshotsDoNotInventContactIdentities() {
	InputFixture fixture;
	contacts = {{-32767, -32767}, {32767, 32767}, {0, 0}};
	fixture.tick();
	auto points = fixture.input.pointerContacts();
	require(points.size() == 3 && pressedQueries == 4 && coordinateQueries == 6, "all pressed indexes are sampled until the first released index");
	require(points[0].x == 0 && points[0].y == 0 && points[1].x == 319 && points[1].y == 239, "each contact has its own decoded viewport coordinates");
	require(points[2].x == 160 && points[2].y == 120, "zero coordinates are a valid pressed center contact");
	const auto* storage = points.data();
	contacts.erase(contacts.begin());
	fixture.tick();
	points = fixture.input.pointerContacts();
	require(points.size() == 2 && points[0].x == 319 && points[0].y == 239 && points[1].x == 160, "index compaction publishes current contacts rather than retaining fake finger identities");
	require(points.data() == storage, "shrinking a contact snapshot retains its storage");
	contacts.clear();
	fixture.tick();
	require(fixture.input.pointerContacts().empty() && fixture.input.pointerContacts().data() == storage, "an empty frame retains allocated contact storage");
	contacts = {{0, 0}, {-32767, 32767}, {32767, -32767}};
	for (int frame = 0; frame < 1000; ++frame) {
		fixture.tick();
		require(fixture.input.pointerContacts().data() == storage, "repeated polls within the contact high-water mark do not reallocate");
	}
}

void testContactCountIsNotArtificiallyCapped() {
	InputFixture fixture;
	contacts.assign(65, PointerSample{-32767, 32767});
	fixture.tick();
	auto points = fixture.input.pointerContacts();
	require(points.size() == 65 && pressedQueries == 66 && coordinateQueries == 130, "the frontend, not a fixed cap in the core, terminates contact enumeration");
	const auto* storage = points.data();
	fixture.input.reset();
	require(fixture.input.pointerContacts().empty(), "reset drops active contacts");
	fixture.tick();
	require(fixture.input.pointerContacts().size() == 65 && fixture.input.pointerContacts().data() == storage, "reset preserves high-water storage for the next sampled frame");
}

void testMouseAndAbsoluteSnapshotsStayIndependent() {
	InputFixture fixture;
	i32 x = 0, y = 0;
	mouse[RETRO_DEVICE_ID_MOUSE_X] = 40;
	mouse[RETRO_DEVICE_ID_MOUSE_Y] = 30;
	fixture.tick();
	require(fixture.input.mousePosition(x, y) && x == 40 && y == 30, "physical mouse position integrates its relative deltas");
	contacts = {{32767, 32767}, {-32767, -32767}};
	mouse[RETRO_DEVICE_ID_MOUSE_X] = 12;
	mouse[RETRO_DEVICE_ID_MOUSE_Y] = -10;
	mouse[RETRO_DEVICE_ID_MOUSE_RIGHT] = 1;
	fixture.tick();
	require(fixture.input.mousePosition(x, y) && x == 52 && y == 20, "absolute contacts do not suppress or reposition the physical mouse");
	require(fixture.input.pointerPosition(x, y) && x == 319 && y == 239, "the guest single-pointer ABI uses the first pressed absolute contact");
	require(!fixture.input.mouseButtonPressed(INP_POINTER_BUTTON_PRIMARY) && fixture.input.mouseButtonPressed(INP_POINTER_BUTTON_SECONDARY), "touch primary and physical mouse buttons have independent host representations");
	require(fixture.input.pointerButtonPressed(INP_POINTER_BUTTON_PRIMARY) && fixture.input.pointerButtonPressed(INP_POINTER_BUTTON_SECONDARY), "the guest ABI combines touch primary with physical mouse buttons");
	fixture.input.consumePointerButton(INP_POINTER_BUTTON_PRIMARY);
	InputControllerSnapshot snapshot{};
	fixture.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	require(snapshot.pointerButtons == (1u << INP_POINTER_BUTTON_SECONDARY), "guest consumption masks routed pointer buttons");
	require(snapshot.pointerXQ16 == 0x013f0000u && snapshot.pointerYQ16 == 0x00ef0000u, "the guest pointer remains raw Q16 register words");
	require(fixture.input.pointerContacts().size() == 2 && fixture.input.mouseButtonPressed(INP_POINTER_BUTTON_SECONDARY), "guest consumption does not modify the physical contact and mouse snapshots");

	contacts.clear();
	mouse.fill(0);
	mouse[RETRO_DEVICE_ID_MOUSE_X] = -7;
	fixture.tick();
	require(fixture.input.mousePosition(x, y) && x == 45 && y == 20, "physical mouse integration continues from its own cursor");
	require(fixture.input.pointerPosition(x, y) && x == 312 && y == 239, "guest relative movement continues from the retained guest cursor");

	fixture.input.reset();
	require(!fixture.input.mousePosition(x, y) && !fixture.input.pointerPosition(x, y), "reset invalidates retained host mouse and guest pointer positions");
	require(!fixture.input.mouseButtonPressed(INP_POINTER_BUTTON_SECONDARY) && !fixture.input.pointerButtonPressed(INP_POINTER_BUTTON_PRIMARY), "reset clears both physical and merged buttons");
}

void testMouseButtonsDoNotRequirePriorMotion() {
	InputFixture fixture;
	i32 x = -1, y = -1;
	mouse[RETRO_DEVICE_ID_MOUSE_LEFT] = mouse[RETRO_DEVICE_ID_MOUSE_RIGHT] = mouse[RETRO_DEVICE_ID_MOUSE_MIDDLE] = mouse[RETRO_DEVICE_ID_MOUSE_BUTTON_4] = mouse[RETRO_DEVICE_ID_MOUSE_BUTTON_5] = 1;
	fixture.tick();
	require(fixture.input.mousePosition(x, y) && x == 0 && y == 0, "a stationary mouse click has the retained initial cursor position");
	for (u32 button : std::array{INP_POINTER_BUTTON_PRIMARY, INP_POINTER_BUTTON_SECONDARY,
		INP_POINTER_BUTTON_AUX, INP_POINTER_BUTTON_BACK, INP_POINTER_BUTTON_FORWARD}) {
		require(fixture.input.mouseButtonPressed(button), "every physical mouse button is exposed independently");
	}
	require(fixture.input.pointerContacts().empty(), "mouse-only callbacks do not manufacture absolute contacts");
	mouse.fill(0);
	fixture.tick();
	require(!fixture.input.mouseButtonPressed(INP_POINTER_BUTTON_PRIMARY), "physical mouse release clears its own button");
}
} // namespace

int main() {
	testRetroPadPositionsUseCanonicalGamepadBits();
	testGamepadHostTargetsKeepTheirRealReleaseLifetime();
	testKeyboardContextAllowsMultipleHostTargetsAndLocalCommands();
	testOrdinaryHardwareXAndZCannotBecomeGamepadHostShortcuts();
	testHardwareTerminalAndMenuChordsRemainIndependentOfGamepadContext();
	testReleasedPointerCoordinatesCannotCaptureMouse();
	testIndexedSnapshotsDoNotInventContactIdentities();
	testContactCountIsNotArtificiallyCapped();
	testMouseAndAbsoluteSnapshotsStayIndependent();
	testMouseButtonsDoNotRequirePriorMotion();
	std::cout << "libretro input tests passed\n";
}
