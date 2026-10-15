#include "host_keyboard_interaction.h"
#include "input.h"
#include "ui_input.h"
#include "render/shared/bmsx_font.h"
#include "render/video_presenter.h"
#include "spec/bmsx/model.h"

#include <array>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>

namespace {
using namespace bmsx;

// Test transport: vector pad words are canonical BMSX bits; callbacks expose the actual libretro ABI.
constexpr std::array<InputControllerGamepadButtonBit, 16> kRetroButtons{
	InputControllerGamepadButtonBit::B, InputControllerGamepadButtonBit::Y,
	InputControllerGamepadButtonBit::Select, InputControllerGamepadButtonBit::Start,
	InputControllerGamepadButtonBit::Up, InputControllerGamepadButtonBit::Down,
	InputControllerGamepadButtonBit::Left, InputControllerGamepadButtonBit::Right,
	InputControllerGamepadButtonBit::A, InputControllerGamepadButtonBit::X,
	InputControllerGamepadButtonBit::LeftBumper, InputControllerGamepadButtonBit::RightBumper,
	InputControllerGamepadButtonBit::LeftTrigger, InputControllerGamepadButtonBit::RightTrigger,
	InputControllerGamepadButtonBit::LeftStick, InputControllerGamepadButtonBit::RightStick,
};

class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32 width, i32 height) override {
		visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(width), static_cast<f32>(height), 0};
	}
};

struct Fixture;
Fixture* active;
void poll() {}
i16 inputState(unsigned port, unsigned device, unsigned index, unsigned id);
bool RETRO_CALLCONV supervisor() { return false; }

struct Fixture {
	i32 width, height;
	LibretroInput input{supervisor};
	OnScreenKeyboard model{input, NATIVE_KEYBOARD_PAGES};
	HostOnScreenKeyboard view{model};
	HostKeyboardInteraction interaction{model, view};
	HostUiInput ui{input};
	TestVideoOutput output;
	VideoPresenter presenter;
	Font font;
	InputControllerSnapshot snapshot{};
	HostMenuFrame published{};
	f64 time = 0;
	i32 mouseX = 0, mouseY = 0;
	i16 mouseDeltaX = 0, mouseDeltaY = 0;
	bool mouseDown = false;
	std::array<u32, 2> pads{};

	Fixture(i32 width, i32 height)
		: width(width), height(height), output(width, height),
		  presenter(output, std::make_unique<SoftwareBackend>(width, height, PSX_MACHINE_SPEC.gxGpuVramBytes), width, height) {
		active = this;
		input.setInputPollCallback(poll);
		input.setInputStateCallback(inputState);
		input.setFrameDurationMs(20);
		for (u8 pad = 0; pad < INPUT_CONTROLLER_PAD_COUNT; ++pad) input.setControllerDevice(pad, RETRO_DEVICE_JOYPAD);
		presenter.default_font = &font;
		input.poll(width, height, 0);
		ui.reset(HostUiInputSource::Gamepad | HostUiInputSource::LeftStick | HostUiInputSource::Pointer, 0);
		interaction.open(input);
		ui.update(0); interaction.tickInput(ui, input, 0); ui.consume();
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		publish();
	}

	void publish() {
		view.queueRenderCommands(presenter);
		published = presenter.hostOverlayQueue.consumeHostMenuFrame();
	}

	void pollInput(f64 delta) {
		time += delta;
		input.poll(width, height, time);
		mouseDeltaX = mouseDeltaY = 0;
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	}

	void frame(f64 delta, i32 x, i32 y, bool down, u32 pad0, u32 pad1) {
		if (x != -1 || y != -1) {
			mouseDeltaX = static_cast<i16>(x - mouseX);
			mouseDeltaY = static_cast<i16>(y - mouseY);
			mouseX = x; mouseY = y;
		}
		mouseDown = down; pads = {pad0, pad1};
		pollInput(delta);
		ui.update(time);
		if (model.visible()) interaction.tickInput(ui, input, time);
		ui.consume();
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		publish();
	}

	std::array<i32, 2> keyCenter(i16 target) const {
		size_t command = 3;
		for (const auto& row : NATIVE_KEYBOARD_PAGES[view.publishedPage()].rows) for (i16 key : row.keys) {
			const auto& area = published.commandRefs[command].rect->area;
			command += 3;
			if (key == target) return {static_cast<i32>((area.left + area.right) / 2), static_cast<i32>((area.top + area.bottom) / 2)};
		}
		throw std::runtime_error("FRAME_KEY target is not present in the published page");
	}
};

i16 inputState(unsigned port, unsigned device, unsigned, unsigned id) {
	if (device == RETRO_DEVICE_JOYPAD && port < active->pads.size()) {
		return (active->pads[port] & (1u << static_cast<u32>(kRetroButtons[id]))) != 0 ? 1 : 0;
	}
	if (device == RETRO_DEVICE_MOUSE && port == 0) {
		if (id == RETRO_DEVICE_ID_MOUSE_X) return active->mouseDeltaX;
		if (id == RETRO_DEVICE_ID_MOUSE_Y) return active->mouseDeltaY;
		if (id == RETRO_DEVICE_ID_MOUSE_LEFT) return active->mouseDown;
	}
	return 0;
}

template <typename Values>
void printNumbers(const Values& values) {
	std::cout << '[';
	bool first = true;
	for (auto value : values) {
		if (!first) std::cout << ',';
		first = false;
		std::cout << +value;
	}
	std::cout << ']';
}

void printSchema() {
	std::cout << "{\"schema\":{\"keys\":[";
	for (size_t key = 0; key < ON_SCREEN_KEY_DEFINITIONS.size(); ++key) {
		if (key != 0) std::cout << ',';
		const auto& item = ON_SCREEN_KEY_DEFINITIONS[key];
		std::cout << "{\"label\":" << std::quoted(item.label) << ",\"usage\":" << +item.usage << ",\"modifier\":" << item.modifier;
		if (item.shiftLabel) std::cout << ",\"shiftLabel\":" << std::quoted(item.shiftLabel);
		std::cout << '}';
	}
	std::cout << "],\"pages\":[";
	for (size_t page = 0; page < NATIVE_KEYBOARD_PAGES.size(); ++page) {
		if (page != 0) std::cout << ',';
		std::cout << "{\"initialKey\":" << NATIVE_KEYBOARD_PAGES[page].initialKey << ",\"rows\":[";
		bool first = true;
		for (const auto& row : NATIVE_KEYBOARD_PAGES[page].rows) {
			if (!first) std::cout << ',';
			first = false;
			std::cout << "{\"units\":" << row.units << ",\"keys\":"; printNumbers(row.keys);
			std::cout << ",\"starts\":"; printNumbers(row.starts);
			std::cout << ",\"spans\":"; printNumbers(row.spans);
			std::cout << '}';
		}
		std::cout << "]}";
	}
	std::cout << "]}}\n";
}

void printCommands(const HostMenuFrame& frame, const BFont* font) {
	std::cout << '[';
	for (size_t index = 0; index < frame.commandCount; ++index) {
		if (index != 0) std::cout << ',';
		switch (frame.commandKinds[index]) {
			case Host2DKind::Rect: {
				const auto& item = *frame.commandRefs[index].rect;
				std::cout << "[\"r\"," << static_cast<unsigned>(item.kind) << ',' << item.area.left << ',' << item.area.top
					<< ',' << item.area.right << ',' << item.area.bottom << ',' << item.area.z << ',' << item.color << ',' << static_cast<unsigned>(item.layer) << ']';
				break;
			}
			case Host2DKind::Glyphs: {
				const auto& item = *frame.commandRefs[index].glyphs;
				std::cout << "[\"g\"," << item.x << ',' << item.y << ',' << item.z << ",[";
				for (size_t part = 0; part < item.items.size(); ++part) {
					if (part != 0) std::cout << ',';
					std::cout << std::quoted(item.items[part]);
				}
				std::cout << "]," << item.item_start << ',' << item.item_end << ',' << item.color << ',' << item.has_background_color << ','
					<< item.background_color << ',' << static_cast<unsigned>(item.layer) << ',' << (item.font == font) << ']';
				break;
			}
			case Host2DKind::Img: {
				const auto& item = *frame.commandRefs[index].img;
				std::cout << "[\"i\"," << std::quoted(item.imgid) << ',' << item.pos.x << ',' << item.pos.y << ',' << item.pos.z
					<< ',' << item.scale.x << ',' << item.scale.y << ',' << item.flip.flip_h << ',' << item.flip.flip_v << ','
					<< item.colorize << ',' << item.ambient_affected << ',' << item.ambient_factor << ',' << static_cast<unsigned>(item.layer) << ']';
				break;
			}
			default: throw std::runtime_error("unexpected bitmap keyboard command");
		}
	}
	std::cout << ']';
}

void printSnapshot(const Fixture& fixture, OnScreenKeyboardAction action, i16 hit, bool commands) {
	const auto& model = fixture.model;
	std::cout << "{\"page\":" << model.page() << ",\"pageCount\":" << model.pageCount() << ",\"selected\":" << model.selectedKey() << ",\"visible\":" << model.visible()
		<< ",\"shift\":" << model.shiftActive() << ",\"revision\":" << model.revision() << ",\"action\":" << static_cast<unsigned>(action)
		<< ",\"pressed\":[";
	for (size_t key = 0; key < ON_SCREEN_KEY_DEFINITIONS.size(); ++key) {
		if (key != 0) std::cout << ',';
		std::cout << (model.isKeyPressed(static_cast<i16>(key)) ? 1 : 0);
	}
	std::cout << "],\"highlighted\":[";
	for (size_t key = 0; key < ON_SCREEN_KEY_DEFINITIONS.size(); ++key) {
		if (key != 0) std::cout << ',';
		std::cout << (model.isKeyHighlighted(static_cast<i16>(key)) ? 1 : 0);
	}
	std::cout << "],\"hid\":"; printNumbers(fixture.snapshot.keyWords);
	std::cout << ",\"publishedPage\":" << fixture.view.publishedPage() << ",\"hit\":" << hit;
	if (commands) { std::cout << ",\"commands\":"; printCommands(fixture.published, fixture.presenter.default_font); }
	std::cout << "}\n";
}
} // namespace

int main(int argc, char** argv) {
	try {
		if (argc != 2) throw std::runtime_error("Usage: bmsx_keyboard_conformance_runner VECTORS");
		std::ifstream vectors(argv[1]);
		vectors.exceptions(std::ios::badbit);
		std::cout << std::boolalpha << std::setprecision(17);
		std::unique_ptr<Fixture> fixture;
		std::string operation;
		while (vectors >> operation) {
			OnScreenKeyboardAction action = OnScreenKeyboardAction::None;
			i16 hit = -1;
			bool commands = false;
			if (operation == "SCHEMA") { printSchema(); continue; }
			if (operation == "RESET") {
				i32 width, height; vectors >> width >> height;
				fixture = std::make_unique<Fixture>(width, height); commands = true;
			} else if (operation == "OPEN") {
				fixture->ui.reset(HostUiInputSource::Gamepad | HostUiInputSource::LeftStick | HostUiInputSource::Pointer, 0);
				fixture->interaction.open(fixture->input);
			} else if (operation == "CLOSE") {
				fixture->interaction.close(); fixture->ui.reset(HostUiInputSource::None, 0);
			} else if (operation == "PAGE") {
				size_t page; vectors >> page; fixture->model.setPage(page);
			} else if (operation == "SELECT") {
				i16 key; size_t page; vectors >> key >> page; fixture->model.selectKey(key, page);
			} else if (operation == "PRESS") {
				size_t source; i16 key; vectors >> source >> key; fixture->model.pressKey(source, key);
			} else if (operation == "RELEASE") {
				size_t source; bool complete; vectors >> source >> complete; fixture->model.releaseSource(source, complete);
			} else if (operation == "COMMAND") {
				size_t source; unsigned command; vectors >> source >> command;
				action = fixture->model.command(source, static_cast<OnScreenKeyboardCommand>(command));
			} else if (operation == "ACTIVATE") {
				size_t source; i16 key; vectors >> source >> key; action = fixture->model.activateKey(source, key);
			} else if (operation == "HORIZONTAL") {
				i32 direction; vectors >> direction; fixture->model.moveHorizontal(direction);
			} else if (operation == "VERTICAL") {
				i32 direction; vectors >> direction; fixture->model.moveVertical(direction);
			} else if (operation == "FEEDBACK") {
				f64 time; vectors >> time; fixture->model.updateFeedback(time);
			} else if (operation == "PUBLISH") {
				fixture->publish(); commands = true;
			} else if (operation == "DOCK") fixture->view.togglePosition();
			else if (operation == "BOUNDS") {
				auto& bounds = fixture->output.visibleViewportBounds;
				vectors >> bounds.left >> bounds.top >> bounds.right >> bounds.bottom;
			} else if (operation == "HIT") {
				i32 x, y; vectors >> x >> y; hit = fixture->view.hitTestAt(x, y);
			} else if (operation == "POLL") {
				f64 delta; vectors >> delta; fixture->pollInput(delta);
			} else if (operation == "PHYSICAL") {
				[[maybe_unused]] size_t key; unsigned retro; bool down; vectors >> key >> retro >> down;
				fixture->input.postKeyboardEvent(retro, down);
			} else if (operation == "FRAME" || operation == "FRAME_KEY") {
				f64 delta; i32 x, y; bool down; u32 pad0, pad1;
				if (operation == "FRAME_KEY") {
					i16 key; i32 dx, dy; vectors >> delta >> key >> dx >> dy >> down >> pad0 >> pad1;
					const auto point = fixture->keyCenter(key); x = point[0] + dx; y = point[1] + dy;
				} else vectors >> delta >> x >> y >> down >> pad0 >> pad1;
				fixture->frame(delta, x, y, down, pad0, pad1); commands = true;
			} else throw std::runtime_error("unknown keyboard conformance operation: " + operation);
			printSnapshot(*fixture, action, hit, commands);
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
