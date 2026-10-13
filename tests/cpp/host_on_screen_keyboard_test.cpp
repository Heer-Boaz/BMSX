#include "host_on_screen_keyboard.h"
#include "hid_keys.h"
#include "input.h"
#include "common/rect.h"
#include "render/shared/bmsx_font.h"
#include "render/video_presenter.h"
#include "spec/bmsx/model.h"
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
void poll() {}
i16 state(unsigned, unsigned, unsigned, unsigned) { return 0; }
bool RETRO_CALLCONV supervisor() { return false; }
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32 w, i32 h) override { visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(w), static_cast<f32>(h), 0}; }
};

void testVisibleViewport() {
	LibretroInput input(supervisor);
	input.setInputPollCallback(poll);
	input.setInputStateCallback(state);
	TestVideoOutput video(256, 192);
	VideoPresenter presenter(video, std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 192);
	Font font;
	presenter.default_font = &font;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard view(keyboard);
	keyboard.open();
	const auto frame = [&]() {
		view.queueRenderCommands(presenter);
		return presenter.hostOverlayQueue.consumeHostMenuFrame();
	};
	const HostMenuFrame normal = frame();
	const auto* panel = normal.commandRefs[0].rect;
	const auto* q = normal.commandRefs[32].rect;
	require(panel->area.right - panel->area.left == 231, "full native keyboard retains its existing panel width");
	require(panel->area.top == video.visibleViewportBounds.top + 4, "actual native keyboard panel docks at the visible picture top");
	require(q->area.right - q->area.left == 13, "full native keyboard retains its existing key unit");
	video.visibleViewportBounds = RectBounds{12.8F, 9.6F, 243.2F, 182.4F, 0};
	const HostMenuFrame cropped = frame();
	require(&presenter.visibleViewportBounds == &video.visibleViewportBounds, "presenter borrows the retained actual output rectangle");
	require(cropped.commandRefs[0].rect == panel && cropped.commandRefs[32].rect == q, "visible layout retains existing commands");
	require(panel->area.right - panel->area.left == 215, "keyboard grid reduces its unit to fit the real cropped width");
	require(panel->area.top == video.visibleViewportBounds.top + 4, "cropped native keyboard retains its direct top anchor");
	require(q->area.right == q->area.left + 12, "cropped keys use the same integer grid as their glyph positions");
	const auto& bounds = presenter.visibleViewportBounds;
	for (size_t index = 0; index < cropped.commandCount; ++index) {
		if (cropped.commandKinds[index] == Host2DKind::Rect) {
			const auto& area = cropped.commandRefs[index].rect->area;
			require(area.left >= bounds.left && area.right <= bounds.right && area.top >= bounds.top && area.bottom <= bounds.bottom,
				"every keyboard panel/key rectangle stays inside the visible target");
		} else if (cropped.commandKinds[index] == Host2DKind::Glyphs) {
			const auto& glyph = *cropped.commandRefs[index].glyphs;
			require(glyph.x >= bounds.left && glyph.x + font.measure(glyph.items[0]) <= bounds.right
				&& glyph.y >= bounds.top && glyph.y + font.lineHeight() <= bounds.bottom,
				"actual font key labels, title and help stay inside the visible target");
		}
	}
	for (size_t key = 0; key < HostOnScreenKeyboard::KeyCount; ++key) {
		const auto center = middlepoint_area(cropped.commandRefs[2 + key * 2].rect->area);
		require(view.selectAt(static_cast<i32>(center.x), static_cast<i32>(center.y)) == static_cast<i32>(key),
			"every painted cropped key remains directly selectable");
	}
	const f32 oldLeft = q->area.left, oldTop = q->area.top;
	video.visibleViewportBounds.bottom -= 10;
	require(frame().commandRefs[32].rect == q && q->area.left == oldLeft && q->area.top == oldTop,
		"a picture-bottom change retains the actual top-docked key paint geometry");
	const auto qCenter = middlepoint_area(q->area);
	require(view.selectAt(static_cast<i32>(qCenter.x), static_cast<i32>(qCenter.y)) == 15,
		"top-docked paint and hit testing continue sharing the same retained key rectangle");
	video.visibleViewportBounds = RectBounds{14.8F, 12.6F, 245.2F, 185.4F, 0};
	require(frame().commandRefs[32].rect == q, "origin-only relayout retains the key command");
	require(q->area.left == oldLeft + 2 && q->area.top == oldTop + 3, "origin-only visible changes invalidate layout cache");
	require(presenter.viewportSize.x == 256 && presenter.viewportSize.y == 192, "host UI layout never resizes the game target");
}

void testFeedback() {
	constexpr u32 idleColor = 0xff252525u;
	constexpr u32 selectedColor = 0xff1e6a95u;
	constexpr u32 pressedColor = 0xffffca55u;
	constexpr u32 textColor = 0xffefefefu;
	constexpr u32 pressedTextColor = 0xff101010u;
	constexpr size_t q = 15u, w = 16u, backspace = 13u, shift = 41u, control = 53u;
	TestVideoOutput video(320, 240);
	VideoPresenter presenter(video, std::make_unique<SoftwareBackend>(320, 240, PSX_MACHINE_SPEC.gxGpuVramBytes), 320, 240);
	Font font;
	presenter.default_font = &font;
	LibretroInput input(supervisor);
	input.setInputPollCallback(poll);
	input.setInputStateCallback(state);
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard view(keyboard);
	InputControllerSnapshot snapshot;
	f64 time = 1000;
	const auto sample = [&]() {
		input.poll(320, 240, time);
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	};
	const auto pressed = [&](u8 usage) {
		return (snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u;
	};
	const auto advance = [&](f64 at) {
		time = at;
		keyboard.updateFeedback(time);
	};
	const auto frame = [&]() {
		view.queueRenderCommands(presenter);
		return presenter.hostOverlayQueue.consumeHostMenuFrame();
	};
	const auto expectKey = [&](size_t key, u32 background, u32 foreground) {
		const HostMenuFrame commands = frame();
		require(commands.commandKinds[2u + key * 2u] == Host2DKind::Rect, "key publishes a real rectangle command");
		require(commands.commandKinds[3u + key * 2u] == Host2DKind::Glyphs, "key publishes a real glyph command");
		require(commands.commandRefs[2u + key * 2u].rect->color == background, "published key background matches forwarded input feedback");
		require(commands.commandRefs[3u + key * 2u].glyphs->color == foreground, "published key label remains legible against feedback");
	};
	const auto select = [&](size_t key) {
		const RectBounds& area = frame().commandRefs[2u + key * 2u].rect->area;
		const Vec2 center = middlepoint_area(area);
		require(view.selectAt(static_cast<i32>(center.x), static_cast<i32>(center.y)) == static_cast<i32>(key), "selection comes from the published key geometry");
	};
	const auto expectHomeEndHelp = [&](u32 color) {
		const HostMenuFrame commands = frame();
		require(commands.commandRefs[2u + HostOnScreenKeyboard::KeyCount * 2u + 1u].glyphs->color == color, "Home/End forwarding highlights their existing binding help line");
	};

	keyboard.open();
	advance(1000);
	expectKey(q, selectedColor, textColor);
	select(w);
	sample();
	require(!pressed(hid_key_usage::W), "selection alone never forwards a key or shows pressed feedback");
	expectKey(w, selectedColor, textColor);
	expectKey(q, idleColor, textColor);
	select(q);
	keyboard.activate(0);
	sample();
	require(pressed(hid_key_usage::Q), "held feedback accompanies the actual key down");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5000);
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.releaseSource(0);
	sample();
	require(!pressed(hid_key_usage::Q), "afterglow does not stretch raw input lifetime");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5119);
	expectKey(q, pressedColor, pressedTextColor);
	advance(5120);
	expectKey(q, selectedColor, textColor);

	advance(5200);
	keyboard.activate(OnScreenKeyboard::PointerSource);
	keyboard.releaseSource(OnScreenKeyboard::PointerSource);
	sample();
	require(!pressed(hid_key_usage::Q), "a completed short pointer tap is already released in the sampled input");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5320);
	expectKey(q, selectedColor, textColor);

	advance(5400);
	keyboard.activate(0);
	keyboard.activate(OnScreenKeyboard::PointerSource);
	keyboard.releaseSource(0);
	advance(6000);
	sample();
	require(pressed(hid_key_usage::Q), "one independent contributor cannot end another contributor's feedback or key");
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.releaseSource(OnScreenKeyboard::PointerSource);
	sample();
	require(!pressed(hid_key_usage::Q), "the final contributor emits key up immediately");
	advance(6120);
	expectKey(q, selectedColor, textColor);

	advance(6200);
	keyboard.activate(0);
	select(w);
	keyboard.activate(OnScreenKeyboard::PointerSource);
	keyboard.releaseSource(0);
	advance(6320);
	expectKey(q, idleColor, textColor);
	expectKey(w, pressedColor, pressedTextColor);
	sample();
	require(!pressed(hid_key_usage::Q) && pressed(hid_key_usage::W), "simultaneously held letters retain independent input and visual lifetimes");
	keyboard.releaseSource(OnScreenKeyboard::PointerSource);

	select(q);
	advance(6400);
	keyboard.activate(0);
	keyboard.releaseSource(0);
	advance(6450);
	keyboard.activate(0);
	advance(6520);
	expectKey(q, pressedColor, pressedTextColor);
	advance(6700);
	keyboard.releaseSource(0);
	advance(6819);
	expectKey(q, pressedColor, pressedTextColor);
	advance(6820);
	expectKey(q, selectedColor, textColor);

	advance(6900);
	keyboard.command(1, OnScreenKeyboardCommand::Backspace);
	expectKey(backspace, pressedColor, pressedTextColor);
	expectKey(q, selectedColor, textColor);
	keyboard.releaseSource(1);
	sample();
	require(!pressed(hid_key_usage::Backspace), "command-key feedback never delays Backspace key up");
	advance(7020);
	expectKey(backspace, idleColor, textColor);

	advance(7100);
	keyboard.command(3, OnScreenKeyboardCommand::Shift);
	keyboard.activate(0);
	keyboard.command(3, OnScreenKeyboardCommand::Shift);
	select(shift);
	sample();
	require(pressed(hid_key_usage::ShiftLeft), "captured shift remains physically forwarded after sticky state ends");
	expectKey(shift, pressedColor, pressedTextColor);
	keyboard.releaseSource(0);
	sample();
	require(!pressed(hid_key_usage::ShiftLeft), "captured shift final release does not wait for visual expiry");
	advance(7219);
	expectKey(shift, pressedColor, pressedTextColor);
	advance(7220);
	expectKey(shift, selectedColor, textColor);

	advance(7300);
	select(control);
	keyboard.activate(3);
	expectKey(control, pressedColor, pressedTextColor);
	select(q);
	keyboard.activate(0);
	select(control);
	keyboard.activate(3);
	sample();
	require(pressed(hid_key_usage::ControlLeft), "captured sticky control remains down until its key source ends");
	expectKey(control, pressedColor, pressedTextColor);
	keyboard.releaseSource(0);
	sample();
	require(!pressed(hid_key_usage::ControlLeft), "captured sticky modifier release is immediate");
	advance(7420);
	expectKey(control, selectedColor, textColor);

	for (const auto command : {OnScreenKeyboardCommand::Home, OnScreenKeyboardCommand::End}) {
		advance(time + 200);
		keyboard.command(0, command);
		expectHomeEndHelp(pressedColor);
		keyboard.releaseSource(0);
		sample();
		require(!pressed(hid_key_usage::Home) && !pressed(hid_key_usage::End), "hidden navigation-key feedback cannot keep navigation input held");
		expectHomeEndHelp(pressedColor);
		advance(time + 120);
		expectHomeEndHelp(0xffb2b2b2u);
	}

	select(q);
	keyboard.activate(0);
	keyboard.releaseSource(0);
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.close();
	keyboard.open();
	expectKey(q, selectedColor, textColor);
	expectHomeEndHelp(0xffb2b2b2u);
}
}

int main() {
	try {
		LibretroInput input(supervisor);
		input.setInputPollCallback(poll);
		input.setInputStateCallback(state);
		OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard view(keyboard);
		InputControllerSnapshot snapshot;
		f64 time = 0;
		const auto sample = [&](f64 delta = 20) {
			time += delta;
			input.poll(256, 212, time);
			input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		};
		const auto pressed = [&](u8 usage) {
			return (snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u;
		};
		for (int hostHz : {60, 120}) {
			keyboard.open();
			keyboard.activate(0);
			for (int frame = 0; frame < hostHz / 10; ++frame) {
				sample(1000.0 / hostHz);
				require(pressed(hid_key_usage::Q), "100ms physical hold survives every host poll");
			}
			keyboard.releaseSource(0);
			sample();
			require(!pressed(hid_key_usage::Q), "actual source release produces key up");
		}
		keyboard.activate(0);
		keyboard.activate(OnScreenKeyboard::PointerSource);
		keyboard.releaseSource(0);
		sample();
		require(pressed(hid_key_usage::Q), "pointer independently retains the shared key");
		keyboard.releaseSource(OnScreenKeyboard::PointerSource);
		sample();
		require(!pressed(hid_key_usage::Q), "final shared contributor releases the key");
		keyboard.activate(0);
		keyboard.moveHorizontal(1);
		keyboard.activate(OnScreenKeyboard::PointerSource);
		keyboard.command(2, OnScreenKeyboardCommand::Backspace);
		sample();
		require(pressed(hid_key_usage::Q) && pressed(hid_key_usage::W) && pressed(hid_key_usage::Backspace), "moving selection never retargets held keys");
		keyboard.releaseSource(0);
		keyboard.releaseSource(2);
		sample();
		require(!pressed(hid_key_usage::Q) && !pressed(hid_key_usage::Backspace) && pressed(hid_key_usage::W), "different source keys release independently");
		keyboard.releaseSource(OnScreenKeyboard::PointerSource);
		keyboard.open();
		keyboard.command(3, OnScreenKeyboardCommand::Shift);
		keyboard.activate(0);
		keyboard.moveHorizontal(1);
		keyboard.activate(1);
		keyboard.releaseSource(0);
		sample();
		require(pressed(hid_key_usage::W) && pressed(hid_key_usage::ShiftLeft), "shift belongs to every still-held shifted key");
		keyboard.releaseSource(1);
		sample();
		require(!pressed(hid_key_usage::ShiftLeft), "one-shot shift ends with the final shifted source");
		keyboard.open();
		for (int row = 0; row < 3; ++row) keyboard.moveVertical(1);
		keyboard.moveHorizontal(-1);
		keyboard.activate(3);
		keyboard.command(0, OnScreenKeyboardCommand::Space);
		keyboard.activate(3);
		sample();
		require(pressed(hid_key_usage::ControlLeft) && pressed(hid_key_usage::Space), "toggling a sticky modifier cannot alter an already-held key");
		keyboard.releaseSource(0);
		sample();
		require(!pressed(hid_key_usage::ControlLeft) && !pressed(hid_key_usage::Space), "captured sticky modifier releases with its key");
		keyboard.command(0, OnScreenKeyboardCommand::Backspace);
		for (int frame = 0; frame < 120; ++frame) {
			sample(1000.0 / 120);
			require(pressed(hid_key_usage::Backspace), "held special keys do not become host-generated repeat pulses");
		}
		keyboard.command(1, OnScreenKeyboardCommand::Home);
		keyboard.command(2, OnScreenKeyboardCommand::End);
		keyboard.close();
		sample();
		for (u32 word : snapshot.keyWords) require(word == 0u, "closing releases every held virtual key and modifier");
		keyboard.open();
		keyboard.activate(0);
		input.postKeyboardEvent(RETROK_q, true);
		keyboard.releaseSource(0);
		sample();
		require(pressed(hid_key_usage::Q), "physical keyboard ownership outlives the released overlay source");
		input.postKeyboardEvent(RETROK_q, false);
		sample();
		require(!pressed(hid_key_usage::Q), "final physical keyboard release clears the sampled bit");
		testFeedback();
		testVisibleViewport();
		std::cout << "HOST-ON-SCREEN-KEYBOARD:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
