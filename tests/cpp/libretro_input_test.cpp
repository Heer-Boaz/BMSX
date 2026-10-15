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
size_t pressedQueries = 0;
size_t coordinateQueries = 0;

void poll() {}
bool RETRO_CALLCONV supervisor() { return false; }
i16 state(unsigned port, unsigned device, unsigned index, unsigned id) {
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
		input.setInputPollCallback(poll);
		input.setInputStateCallback(state);
	}
	void tick() {
		pressedQueries = coordinateQueries = 0;
		input.poll(320, 240, time);
		time += 20;
	}
};

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
	testReleasedPointerCoordinatesCannotCaptureMouse();
	testIndexedSnapshotsDoNotInventContactIdentities();
	testContactCountIsNotArtificiallyCapped();
	testMouseAndAbsoluteSnapshotsStayIndependent();
	testMouseButtonsDoNotRequirePriorMotion();
	std::cout << "libretro input tests passed\n";
}
