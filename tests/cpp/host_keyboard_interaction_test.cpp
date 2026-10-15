#include "host_keyboard_interaction.h"
#include "input.h"
#include "ui_input.h"
#include "common/rect.h"
#include "render/shared/bmsx_font.h"
#include "render/video_presenter.h"
#include "spec/bmsx/model.h"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
using namespace bmsx;
constexpr i32 Width = 320, Height = 240;
std::vector<LibretroPointerContact> contacts;
u16 buttons = 0;
i16 mouseDeltaX = 0, mouseDeltaY = 0;
bool mousePressed = false;
void poll() {}
i16 state(unsigned port, unsigned device, unsigned index, unsigned id) {
	if (port != 0) return 0;
	if (device == RETRO_DEVICE_POINTER && index < contacts.size()) {
		if (id == RETRO_DEVICE_ID_POINTER_PRESSED) return 1;
		if (id == RETRO_DEVICE_ID_POINTER_X) return static_cast<i16>(contacts[index].x * 65534 / (Width - 1) - 32767);
		if (id == RETRO_DEVICE_ID_POINTER_Y) return static_cast<i16>(contacts[index].y * 65534 / (Height - 1) - 32767);
	}
	if (device == RETRO_DEVICE_MOUSE) {
		if (id == RETRO_DEVICE_ID_MOUSE_LEFT) return mousePressed;
		if (id == RETRO_DEVICE_ID_MOUSE_X) return mouseDeltaX;
		if (id == RETRO_DEVICE_ID_MOUSE_Y) return mouseDeltaY;
	}
	return device == RETRO_DEVICE_JOYPAD && (buttons & (1u << id)) != 0 ? 1 : 0;
}
bool RETRO_CALLCONV supervisor() { return false; }
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32 w, i32 h) override { visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(w), static_cast<f32>(h), 0}; }
};

struct Fixture {
	LibretroInput input{supervisor};
	OnScreenKeyboard model{input, NATIVE_KEYBOARD_PAGES};
	HostOnScreenKeyboard view{model};
	HostKeyboardInteraction interaction{model, view};
	HostUiInput ui{input};
	TestVideoOutput output{Width, Height};
	VideoPresenter presenter{output, std::make_unique<SoftwareBackend>(Width, Height, PSX_MACHINE_SPEC.gxGpuVramBytes), Width, Height};
	Font font;
	f64 time = 0;
	explicit Fixture(std::span<const OnScreenKeyboardPage> pages = NATIVE_KEYBOARD_PAGES) : model(input, pages) {
		contacts.clear(); buttons = 0; mouseDeltaX = mouseDeltaY = 0; mousePressed = false;
		input.setInputPollCallback(poll); input.setInputStateCallback(state); input.setControllerDevice(0, RETRO_DEVICE_JOYPAD);
		presenter.default_font = &font;
		input.poll(Width, Height, time);
		ui.reset(HostUiInputSource::Gamepad | HostUiInputSource::LeftStick | HostUiInputSource::Pointer, 0);
		interaction.open(input);
		tick();
	}
	void tick() {
		time += 20;
		input.poll(Width, Height, time);
		mouseDeltaX = mouseDeltaY = 0;
		ui.update(time); interaction.tickInput(ui, input, time); ui.consume();
		view.queueRenderCommands(presenter);
	}
	void press(u16 mask) { buttons = mask; tick(); buttons = 0; tick(); }
	LibretroPointerContact center(i16 target) {
		view.queueRenderCommands(presenter);
		const auto frame = presenter.hostOverlayQueue.consumeHostMenuFrame();
		size_t command = 3;
		for (const auto& row : model.rows()) for (i16 key : row.keys) {
			const auto& rect = frame.commandRefs[command].rect->area; command += 3;
			if (key == target) {
				const auto center = middlepoint_area(rect);
				return {static_cast<i32>(center.x), static_cast<i32>(center.y)};
			}
		}
		throw std::runtime_error("test target is absent from current published page");
	}
	void mouseAt(LibretroPointerContact point) {
		i32 x = 0, y = 0; input.mousePosition(x, y);
		mouseDeltaX = static_cast<i16>(point.x - x); mouseDeltaY = static_cast<i16>(point.y - y);
	}
	bool held(u8 usage) const { return model.isKeyPressed(ON_SCREEN_KEY_INDEX_BY_USAGE[usage]); }
	f32 panelTop() {
		view.queueRenderCommands(presenter);
		return presenter.hostOverlayQueue.consumeHostMenuFrame().commandRefs[0].rect->area.top;
	}
};

i16 key(u8 usage) { return ON_SCREEN_KEY_INDEX_BY_USAGE[usage]; }

void testPurePublishedHitGeometry() {
	LibretroInput input(supervisor);
	OnScreenKeyboard model(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard view(model);
	require(view.hitTestAt(0, 0) == -1, "a not-yet-published keyboard has no interactive geometry");
	Fixture f;
	const auto q = f.center(key(hid_key_usage::Q));
	const auto revision = f.model.revision();
	require(f.view.hitTestAt(q.x, q.y) == key(hid_key_usage::Q) && f.model.revision() == revision,
		"bitmap hit testing returns a target without changing model selection");
	const auto page = f.view.publishedPage();
	f.model.setPage(static_cast<size_t>(KeyboardPage::Functions));
	require(f.view.publishedPage() == page && f.view.hitTestAt(q.x, q.y) == key(hid_key_usage::Q),
		"before redraw hit testing still belongs to its actually published page");
	f.view.queueRenderCommands(f.presenter);
	require(f.view.publishedPage() == static_cast<size_t>(KeyboardPage::Functions), "redraw publishes page identity with its actual geometry");
}

void testControllerAndContactSources() {
	Fixture f;
	const auto q = f.center(key(hid_key_usage::Q));
	contacts = {q}; f.tick(); buttons = 1u << RETRO_DEVICE_ID_JOYPAD_A; f.tick();
	contacts.clear(); f.tick();
	require(f.held(hid_key_usage::Q), "controller source retains the same key after its absolute contact leaves");
	buttons = 0; f.tick(); require(!f.held(hid_key_usage::Q), "controller up releases its own contribution after contact up");
	contacts = {q}; f.tick(); buttons = 1u << RETRO_DEVICE_ID_JOYPAD_A; f.tick(); buttons = 0; f.tick();
	require(f.held(hid_key_usage::Q), "an absolute contact independently retains the key after controller up");
	contacts.clear(); f.tick(); require(!f.held(hid_key_usage::Q), "the last independent source releases the key");
}

void testAbsoluteOccupancy() {
	Fixture f;
	const auto q = f.center(key(hid_key_usage::Q)), w = f.center(key(hid_key_usage::W));
	contacts = {q, w}; f.tick();
	require(f.held(hid_key_usage::Q) && f.held(hid_key_usage::W), "two absolute contacts independently press two physical key targets");
	std::swap(contacts[0], contacts[1]); f.tick();
	require(f.held(hid_key_usage::Q) && f.held(hid_key_usage::W), "native index reordering never reassigns or releases occupied keys");
	contacts = {w}; f.tick();
	require(!f.held(hid_key_usage::Q) && f.held(hid_key_usage::W), "index compaction preserves the still occupied key");
	contacts = {w, w}; f.tick(); contacts = {w}; f.tick();
	require(f.held(hid_key_usage::W), "two contacts on one key require its last occupant to leave");
	contacts.clear(); f.tick();
	require(!f.held(hid_key_usage::W), "the last actual contact up releases its exact key");
	InputControllerSnapshot snapshot{}; f.tick(); f.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	for (auto word : snapshot.keyWords) require(word == 0, "native polling forwards final release without a synthetic minimum hold");
}

void testModifiers() {
	Fixture f;
	const auto shift = f.center(key(hid_key_usage::ShiftLeft)), q = f.center(key(hid_key_usage::Q));
	contacts = {q, shift}; f.tick();
	require(f.held(hid_key_usage::ShiftLeft) && f.held(hid_key_usage::Q), "same-poll native chord publishes its modifier before the ordinary key regardless of contact order");
	contacts = {shift}; f.tick(); contacts.clear(); f.tick();
	require(!f.held(hid_key_usage::ShiftLeft), "a completed modifier chord never latches as an unused tap");
	contacts = {shift}; f.tick(); contacts.clear(); f.tick();
	require(f.held(hid_key_usage::ShiftLeft), "a genuinely unused native modifier tap latches only on all-up");
	contacts = {q}; f.tick(); contacts.clear(); f.tick();
	require(!f.held(hid_key_usage::ShiftLeft), "a latched Shift is consumed by the subsequent ordinary key");
	contacts = {shift}; f.tick(); contacts = {{0, 0}}; f.tick(); contacts.clear(); f.tick();
	require(!f.held(hid_key_usage::ShiftLeft), "sliding outside a modifier is not an eligible modifier tap");
}

void testPointerChannelGestures() {
	Fixture f;
	const auto q = f.center(key(hid_key_usage::Q)), w = f.center(key(hid_key_usage::W));
	f.mouseAt(w); mousePressed = true; contacts = {q}; f.tick();
	require(f.held(hid_key_usage::Q) && !f.held(hid_key_usage::W), "absolute contacts take a new gesture rather than duplicating a frontend mouse alias");
	contacts.clear(); f.tick();
	require(!f.held(hid_key_usage::Q) && !f.held(hid_key_usage::W), "the losing mouse sequence stays blocked after absolute contacts end");
	mousePressed = false; f.tick(); mousePressed = true; f.tick();
	require(f.held(hid_key_usage::W), "a fresh mouse sequence works after its actual up");
	f.mouseAt(q); contacts = {q}; f.tick();
	require(f.held(hid_key_usage::W) && !f.held(hid_key_usage::Q), "mouse capture remains on its down key while moving and blocks the absolute alias channel");
	mousePressed = false; f.tick();
	require(!f.held(hid_key_usage::W) && !f.held(hid_key_usage::Q), "mouse up releases its captured key without transferring to an already held contact");
	contacts.clear(); f.tick(); contacts = {q}; f.tick();
	require(f.held(hid_key_usage::Q), "a fresh absolute gesture is accepted after genuine all-up");
	contacts.clear(); f.tick();
}

void testMouseReleaseReconcilesFocusBeforeControllerCommands() {
	{
		Fixture f;
		const auto q = f.center(key(hid_key_usage::Q)), w = f.center(key(hid_key_usage::W));
		f.mouseAt(q); mousePressed = true; f.tick();
		f.mouseAt(w); f.tick();
		require(f.model.selectedKey() == key(hid_key_usage::Q) && f.held(hid_key_usage::Q), "held mouse movement preserves its captured key and focus");
		mousePressed = false; buttons = 1u << RETRO_DEVICE_ID_JOYPAD_A; f.tick();
		require(f.model.selectedKey() == key(hid_key_usage::W) && f.held(hid_key_usage::W) && !f.held(hid_key_usage::Q),
			"mouse up reconciles the release-position focus before a same-poll controller activation");
		buttons = 0; f.tick(); require(!f.held(hid_key_usage::W), "controller up releases the newly activated hover target");
	}
	{
		Fixture f;
		const auto q = f.center(key(hid_key_usage::Q));
		f.mouseAt(q); mousePressed = true; f.tick();
		f.press(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
		require(f.model.selectedKey() == key(hid_key_usage::W), "controller navigation may change focus while a mouse key stays captured");
		mousePressed = false; buttons = 1u << RETRO_DEVICE_ID_JOYPAD_A; f.tick();
		require(f.model.selectedKey() == key(hid_key_usage::Q) && f.held(hid_key_usage::Q) && !f.held(hid_key_usage::W),
			"mouse up restores its release-position focus even when the cursor coordinates did not change");
		buttons = 0; f.tick(); require(!f.held(hid_key_usage::Q), "same-position activation still has an independent controller lifetime");
	}
	{
		Fixture f;
		const auto q = f.center(key(hid_key_usage::Q)), position = f.center(ON_SCREEN_KEYBOARD_POSITION_TARGET);
		const auto top = f.panelTop();
		f.mouseAt(position); mousePressed = true; f.tick();
		f.mouseAt(q); f.tick();
		mousePressed = false; buttons = 1u << RETRO_DEVICE_ID_JOYPAD_A; f.tick();
		require(f.panelTop() != top && f.model.selectedKey() == key(hid_key_usage::Q) && f.held(hid_key_usage::Q),
			"dock up completes once, then hover uses the published old geometry before same-poll controller activation");
		buttons = 0; f.tick(); require(!f.held(hid_key_usage::Q), "docking does not change the controller key's real release");
	}
}

void testDeferredGeometryActions() {
	Fixture f;
	const auto position = f.center(ON_SCREEN_KEYBOARD_POSITION_TARGET);
	const auto top = f.panelTop();
	contacts = {position}; f.tick();
	contacts = {{0, 0}}; f.tick(); contacts = {position}; f.tick();
	for (int frame = 0; frame < 20; ++frame) f.tick();
	require(f.panelTop() == top, "touch docking never moves geometry beneath a held absolute contact");
	contacts.clear(); f.tick();
	require(f.panelTop() != top, "the touch docking action completes once at actual all-up");
	const auto q = f.center(key(hid_key_usage::Q));
	contacts = {q}; f.tick();
	f.press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_Y));
	require(f.model.page() == 0 && f.held(hid_key_usage::Q), "controller page changes queue rather than replacing held absolute-contact geometry");
	contacts.clear(); f.tick();
	require(f.model.page() == 1 && !f.held(hid_key_usage::Q), "the queued page command runs after real contact release");
	f.model.setPage(0); f.tick();
	const auto newQ = f.center(key(hid_key_usage::Q));
	contacts = {newQ}; f.tick();
	f.model.selectKey(ON_SCREEN_KEYBOARD_POSITION_TARGET, 0);
	const auto beforeControllerDock = f.panelTop();
	f.press(1u << RETRO_DEVICE_ID_JOYPAD_A);
	require(f.panelTop() == beforeControllerDock && f.held(hid_key_usage::Q), "controller docking is also deferred while absolute input owns geometry");
	contacts.clear(); f.tick(); require(f.panelTop() != beforeControllerDock, "queued controller docking runs after its independent touch releases");
	const auto dock = f.center(ON_SCREEN_KEYBOARD_POSITION_TARGET);
	const auto beforeAliasedDock = f.panelTop();
	f.mouseAt(dock); mousePressed = true; contacts = {dock}; f.tick();
	contacts.clear(); f.tick();
	require(f.panelTop() != beforeAliasedDock, "an absolute and mouse alias completes one docking action");
	const auto afterAliasedDock = f.panelTop();
	mousePressed = false; f.tick();
	require(f.panelTop() == afterAliasedDock, "the blocked mouse alias cannot dispatch a duplicate docking action on later up");
}

void testOpenCloseAndMouseModifiers() {
	Fixture f;
	const auto q = f.center(key(hid_key_usage::Q)), shift = f.center(key(hid_key_usage::ShiftLeft));
	contacts = {q}; f.tick(); require(f.held(hid_key_usage::Q), "test starts with a genuine native touch key");
	f.interaction.close(); f.interaction.open(f.input); f.tick();
	require(!f.held(hid_key_usage::Q), "closing releases keys and reopening cannot acquire the already held absolute sequence");
	contacts.clear(); f.tick(); contacts = {q}; f.tick(); require(f.held(hid_key_usage::Q), "new absolute down after reopen remains usable");
	contacts.clear(); f.tick();
	f.mouseAt(shift); mousePressed = true; f.tick();
	require(f.held(hid_key_usage::ShiftLeft), "mouse modifier down forwards a real held modifier");
	mousePressed = false; f.tick(); require(f.held(hid_key_usage::ShiftLeft), "unused mouse modifier tap latches on actual mouse up");
	f.mouseAt(q); mousePressed = true; f.tick(); mousePressed = false; f.tick();
	require(!f.held(hid_key_usage::ShiftLeft), "typing after a mouse-latched Shift consumes it through the shared model");
	f.mouseAt(q); mousePressed = true; f.tick(); f.interaction.close(); f.interaction.open(f.input); f.tick();
	require(!f.held(hid_key_usage::Q), "reopen also blocks an already held mouse button sequence");
	mousePressed = false; f.tick();
}

void testQueuedPageCountUsesModelSchema() {
	const auto pageButton = (1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_Y);
	{
		Fixture f;
		contacts = {{0, 0}}; f.tick(); const auto revision = f.model.revision();
		for (size_t page = 0; page < f.model.pageCount(); ++page) f.press(pageButton);
		contacts.clear(); f.tick();
		require(f.model.page() == 0 && f.model.revision() == revision, "a full deferred page cycle neither rebuilds intermediate pages nor publishes redundant revisions");
	}
	{
		const std::array<OnScreenKeyboardPage, 2> pages{NATIVE_KEYBOARD_PAGES[0], NATIVE_KEYBOARD_PAGES[2]};
		Fixture f(pages);
		require(f.model.pageCount() == pages.size(), "page count is owned by the injected keyboard schema, not hardcoded native layout constants");
		contacts = {{0, 0}}; f.tick(); const auto revision = f.model.revision();
		f.press(pageButton); f.press(pageButton); contacts.clear(); f.tick();
		require(f.model.page() == 0 && f.model.revision() == revision, "a two-page schema also reduces a full deferred cycle to no layout change");
		contacts = {{0, 0}}; f.tick(); f.press(pageButton); contacts.clear(); f.tick();
		require(f.model.page() == 1 && f.model.revision() == revision + 1, "a partial deferred cycle publishes only the final schema-relative page");
	}
}
} // namespace

int main() {
	try {
		testPurePublishedHitGeometry(); testAbsoluteOccupancy(); testModifiers(); testPointerChannelGestures(); testMouseReleaseReconcilesFocusBeforeControllerCommands(); testControllerAndContactSources();
		testDeferredGeometryActions(); testOpenCloseAndMouseModifiers(); testQueuedPageCountUsesModelSchema();
		std::cout << "host_keyboard_interaction_test: ok\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
