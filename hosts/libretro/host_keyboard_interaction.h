#pragma once

#include "host_on_screen_keyboard.h"
#include <array>

namespace bmsx {
class HostUiInput;
class LibretroInput;

/** Device interaction for the bitmap keyboard, independent of foreground menus. */
class HostKeyboardInteraction {
public:
	HostKeyboardInteraction(OnScreenKeyboard& model, HostOnScreenKeyboard& view);
	void open(LibretroInput& input);
	void close();
	void tickInput(HostUiInput& ui, LibretroInput& input, f64 currentTimeMs);
	OnScreenKeyboard& model;
	HostOnScreenKeyboard& view;

private:
	enum class PointerGesture : u8 { None, Absolute, Mouse };
	void tickPointerInput(LibretroInput& input);
	void updateAbsoluteContacts(LibretroInput& input);
	void beginMouseGesture(LibretroInput& input);
	void dispatchCommand(size_t source, OnScreenKeyboardCommand command);
	void dispatchAction(OnScreenKeyboardAction action);
	void completeAbsoluteGesture();

	std::array<size_t, OnScreenKeyboard::KeyCount> m_contactSources;
	std::array<u32, OnScreenKeyboard::KeyCount> m_contactCounts{};
	std::array<u32, OnScreenKeyboard::KeyCount> m_nextContactCounts{};
	PointerGesture m_pointerGesture = PointerGesture::None;
	bool m_absoluteBlocked = false;
	bool m_mouseBlocked = false;
	bool m_mousePositionValid = false;
	i32 m_mouseX = 0, m_mouseY = 0;
	i16 m_mouseKey = -1;
	bool m_pendingPosition = false;
	size_t m_pendingPageChanges = 0;
	bool m_positionContactHeld = false;
};
} // namespace bmsx
