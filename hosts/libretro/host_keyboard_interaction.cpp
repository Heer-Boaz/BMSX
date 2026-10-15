#include "host_keyboard_interaction.h"

#include "input.h"
#include "ui_input.h"

namespace bmsx {
namespace {
struct CommandBinding {
	InputControllerGamepadButtonBit button;
	OnScreenKeyboardCommand command;
	bool requiresSelect;
};

constexpr auto kCommandBindings = std::to_array<CommandBinding>({
	{InputControllerGamepadButtonBit::B, OnScreenKeyboardCommand::Delete, true},
	{InputControllerGamepadButtonBit::Y, OnScreenKeyboardCommand::TogglePage, true},
	{InputControllerGamepadButtonBit::LeftBumper, OnScreenKeyboardCommand::Home, true},
	{InputControllerGamepadButtonBit::RightBumper, OnScreenKeyboardCommand::End, true},
	{InputControllerGamepadButtonBit::B, OnScreenKeyboardCommand::Space, false},
	{InputControllerGamepadButtonBit::X, OnScreenKeyboardCommand::Backspace, false},
	{InputControllerGamepadButtonBit::Y, OnScreenKeyboardCommand::Shift, false},
	{InputControllerGamepadButtonBit::LeftBumper, OnScreenKeyboardCommand::Left, false},
	{InputControllerGamepadButtonBit::RightBumper, OnScreenKeyboardCommand::Right, false},
	{InputControllerGamepadButtonBit::LeftTrigger, OnScreenKeyboardCommand::Home, false},
	{InputControllerGamepadButtonBit::RightTrigger, OnScreenKeyboardCommand::End, false},
	{InputControllerGamepadButtonBit::Start, OnScreenKeyboardCommand::Enter, false},
	{InputControllerGamepadButtonBit::A, OnScreenKeyboardCommand::Activate, false},
});
} // namespace

HostKeyboardInteraction::HostKeyboardInteraction(OnScreenKeyboard& model, HostOnScreenKeyboard& view)
	: model(model), view(view) {
	for (auto& source : m_contactSources) source = model.allocateSource();
}

void HostKeyboardInteraction::open(LibretroInput& input) {
	m_pointerGesture = PointerGesture::None;
	m_absoluteBlocked = !input.pointerContacts().empty();
	m_mouseBlocked = input.mouseButtonPressed(INP_POINTER_BUTTON_PRIMARY);
	m_mousePositionValid = input.mousePosition(m_mouseX, m_mouseY);
	m_mouseKey = -1;
	m_contactCounts.fill(0);
	m_positionContactHeld = false;
	m_pendingPosition = false;
	m_pendingPageChanges = 0;
	model.open();
}

void HostKeyboardInteraction::close() {
	model.close();
	m_pointerGesture = PointerGesture::None;
	m_contactCounts.fill(0);
	m_mouseKey = -1;
	m_positionContactHeld = false;
	m_pendingPosition = false;
	m_pendingPageChanges = 0;
}

void HostKeyboardInteraction::tickInput(HostUiInput& ui, LibretroInput& input, f64 currentTimeMs) {
	model.updateFeedback(currentTimeMs);
	tickPointerInput(input);
	if (ui.buttonRepeatEdge(InputControllerGamepadButtonBit::Up)) model.moveVertical(-1);
	if (ui.buttonRepeatEdge(InputControllerGamepadButtonBit::Down)) model.moveVertical(1);
	if (ui.buttonRepeatEdge(InputControllerGamepadButtonBit::Left)) model.moveHorizontal(-1);
	if (ui.buttonRepeatEdge(InputControllerGamepadButtonBit::Right)) model.moveHorizontal(1);
	for (u8 player = 0; player < INPUT_CONTROLLER_PAD_COUNT; ++player) {
		const size_t sourceBase = player * INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
		for (u8 button = 0; button < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT; ++button) {
			if (!ui.gamepadButtonPressed(player, static_cast<InputControllerGamepadButtonBit>(button))) model.releaseSource(sourceBase + button);
		}
		for (const auto& binding : kCommandBindings) {
			if (ui.gamepadButtonJustPressed(player, binding.button)
				&& ui.gamepadButtonPressed(player, InputControllerGamepadButtonBit::Select) == binding.requiresSelect) {
				dispatchCommand(sourceBase + static_cast<size_t>(binding.button), binding.command);
			}
		}
	}
}

void HostKeyboardInteraction::tickPointerInput(LibretroInput& input) {
	const bool absoluteDown = !input.pointerContacts().empty();
	const bool mouseDown = input.mouseButtonPressed(INP_POINTER_BUTTON_PRIMARY);
	if (!absoluteDown) m_absoluteBlocked = false;
	if (!mouseDown) m_mouseBlocked = false;
	if (m_pointerGesture == PointerGesture::None) {
		if (absoluteDown && !m_absoluteBlocked) m_pointerGesture = PointerGesture::Absolute;
		else if (mouseDown && !m_mouseBlocked) {
			m_pointerGesture = PointerGesture::Mouse;
			beginMouseGesture(input);
		}
	}
	if (m_pointerGesture == PointerGesture::Absolute) {
		if (mouseDown) m_mouseBlocked = true;
		updateAbsoluteContacts(input);
		if (!absoluteDown) {
			m_pointerGesture = PointerGesture::None;
			completeAbsoluteGesture();
		}
		return;
	}
	if (m_pointerGesture == PointerGesture::Mouse) {
		if (absoluteDown) m_absoluteBlocked = true;
		if (!mouseDown) {
			model.releaseSource(OnScreenKeyboard::PointerSource, true);
			if (m_mouseKey == ON_SCREEN_KEYBOARD_POSITION_TARGET) dispatchAction(OnScreenKeyboardAction::TogglePosition);
			m_mouseKey = -1;
			m_pointerGesture = PointerGesture::None;
		}
		return;
	}
	const i32 previousX = m_mouseX, previousY = m_mouseY;
	const bool wasValid = m_mousePositionValid;
	m_mousePositionValid = input.mousePosition(m_mouseX, m_mouseY);
	if (!mouseDown && m_mousePositionValid && (!wasValid || previousX != m_mouseX || previousY != m_mouseY)) {
		const i16 key = view.hitTestAt(m_mouseX, m_mouseY);
		if (key >= 0) model.selectKey(key, view.publishedPage());
	}
}

void HostKeyboardInteraction::updateAbsoluteContacts(LibretroInput& input) {
	const auto contacts = input.pointerContacts();
	m_nextContactCounts.fill(0);
	bool positionHeld = false;
	for (const auto& contact : contacts) {
		const i16 key = view.hitTestAt(contact.x, contact.y);
		if (key == ON_SCREEN_KEYBOARD_POSITION_TARGET) positionHeld = true;
		else if (key >= 0) ++m_nextContactCounts[static_cast<size_t>(key)];
	}
	if (positionHeld && !m_positionContactHeld) {
		model.selectKey(ON_SCREEN_KEYBOARD_POSITION_TARGET, view.publishedPage());
		m_pendingPosition = !m_pendingPosition;
	}
	m_positionContactHeld = m_positionContactHeld || positionHeld;
	for (size_t key = 0; key < m_contactCounts.size(); ++key) {
		if (m_contactCounts[key] != 0 && m_nextContactCounts[key] == 0) {
			// Indexed POINTER contacts have no stable identity: only all-up proves a tap ended.
			model.releaseSource(m_contactSources[key], contacts.empty());
		}
	}
	// A same-poll modifier/letter chord must publish the modifier before the letter.
	for (size_t phase = 0; phase < 2; ++phase) {
		for (size_t key = 0; key < m_contactCounts.size(); ++key) {
			const bool modifier = ON_SCREEN_KEY_DEFINITIONS[key].modifier != kNoModifier;
			if (modifier != (phase == 0) || m_contactCounts[key] != 0 || m_nextContactCounts[key] == 0) continue;
			model.selectKey(static_cast<i16>(key), view.publishedPage());
			model.pressKey(m_contactSources[key], static_cast<i16>(key));
		}
	}
	m_contactCounts = m_nextContactCounts;
}

void HostKeyboardInteraction::beginMouseGesture(LibretroInput& input) {
	// A mouse owns its down target until up, even after moving outside the key.
	m_mousePositionValid = input.mousePosition(m_mouseX, m_mouseY);
	if (!m_mousePositionValid) return;
	m_mouseKey = view.hitTestAt(m_mouseX, m_mouseY);
	if (m_mouseKey < 0) return;
	model.selectKey(m_mouseKey, view.publishedPage());
	if (m_mouseKey != ON_SCREEN_KEYBOARD_POSITION_TARGET) model.pressKey(OnScreenKeyboard::PointerSource, m_mouseKey);
}

void HostKeyboardInteraction::dispatchCommand(size_t source, OnScreenKeyboardCommand command) {
	if (command == OnScreenKeyboardCommand::TogglePage && m_pointerGesture == PointerGesture::Absolute) {
		m_pendingPageChanges = (m_pendingPageChanges + 1) % model.pageCount();
		return;
	}
	dispatchAction(model.command(source, command));
}

void HostKeyboardInteraction::dispatchAction(OnScreenKeyboardAction action) {
	if (action != OnScreenKeyboardAction::TogglePosition) return;
	if (m_pointerGesture == PointerGesture::Absolute) m_pendingPosition = !m_pendingPosition;
	else view.togglePosition();
}

void HostKeyboardInteraction::completeAbsoluteGesture() {
	m_positionContactHeld = false;
	model.setPage((model.page() + m_pendingPageChanges) % model.pageCount());
	m_pendingPageChanges = 0;
	if (m_pendingPosition) {
		view.togglePosition();
		m_pendingPosition = false;
	}
}
} // namespace bmsx
