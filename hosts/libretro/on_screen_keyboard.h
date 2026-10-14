#pragma once
#include "common/primitives.h"
#include "machine/devices/input/contracts.h"
#include "on_screen_keyboard_keys.h"
#include <array>
#include <limits>
#include <span>
#include <vector>

namespace bmsx {
class LibretroInput;

/** Geometry-independent owner of virtual keyboard source/key lifetimes. */
class OnScreenKeyboard {
public:
	static constexpr size_t KeyCount = ON_SCREEN_KEY_DEFINITIONS.size();
	static constexpr size_t PointerSource = INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
	static constexpr size_t InitialSourceCount = PointerSource + 1;
	OnScreenKeyboard(LibretroInput& input, std::span<const OnScreenKeyboardPage> pages);
	size_t page() const { return m_page; }
	std::span<const OnScreenKeyboardRow> rows() const { return m_pages[m_page].rows; }
	i16 selectedKey() const { return m_selected; }
	bool visible() const { return m_visible; }
	u64 revision() const { return m_revision; }
	bool shiftActive() const { return m_modifierPressed[kModifierShift]; }
	size_t allocateSource();
	void open();
	void close();
	void setPage(size_t page);
	void selectKey(i16 key, size_t page);
	void moveHorizontal(i32 direction);
	void moveVertical(i32 direction);
	void activate(size_t source);
	void activateKey(size_t source, i16 key);
	void pressKey(size_t source, i16 key);
	void releaseSource(size_t source, bool completeModifierTap = false);
	void command(size_t source, OnScreenKeyboardCommand command);
	const char* label(i16 key) const;
	bool isKeyPressed(i16 key) const;
	bool isKeyHighlighted(i16 key) const;
	void updateFeedback(f64 currentTimeMs);
private:
	bool releaseKeySource(size_t source);
	void publishModifier(size_t modifier);
	void recordKeyFeedback(size_t key, bool down);
	LibretroInput& m_input;
	std::span<const OnScreenKeyboardPage> m_pages;
	std::vector<i16> m_sourceKeys;
	std::vector<u8> m_sourceModifiers;
	std::vector<u8> m_sourceModifierTapEligible;
	std::vector<u64> m_sourceModifierTapGeneration;
	size_t m_ordinaryHeldSources = 0;
	u64 m_ordinaryPressGeneration = 0;
	std::array<u32, KeyCount> m_keyCounts{};
	std::array<u32, 3> m_modifierCounts{};
	std::array<bool, 3> m_modifierStates{}, m_modifierPressed{};
	std::array<f64, KeyCount> m_feedbackUntilMs{};
	f64 m_feedbackTimeMs = 0;
	f64 m_nextFeedbackExpiryMs = std::numeric_limits<f64>::infinity();
	size_t m_page = 0;
	i16 m_selected;
	i32 m_selectedRow;
	std::vector<i16> m_pageSelections;
	std::vector<std::array<i16, KeyCount>> m_pageKeyRows;
	std::vector<std::array<f32, KeyCount>> m_pageKeyCenters;
	bool m_visible = false;
	u64 m_revision = 0;
};
} // namespace bmsx
