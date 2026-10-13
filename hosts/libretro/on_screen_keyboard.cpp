#include "on_screen_keyboard.h"
#include "input.h"
#include <algorithm>
#include <cmath>

namespace bmsx {
namespace { constexpr f64 kReleaseFeedbackMs = 120; }
OnScreenKeyboard::OnScreenKeyboard(LibretroInput& input, std::span<const OnScreenKeyboardPage> pages)
	: m_input(input), m_pages(pages), m_sourceKeys(InitialSourceCount, -1), m_sourceModifiers(InitialSourceCount, 0),
	  m_sourceModifierTapEligible(InitialSourceCount, 0), m_sourceModifierTapGeneration(InitialSourceCount, 0),
	  m_selected(pages[0].initialKey), m_selectedRow(0) {
	m_pageSelections.reserve(pages.size());
	m_pageKeyRows.resize(pages.size());
	m_pageKeyCenters.resize(pages.size());
	for (size_t pageIndex = 0; pageIndex < pages.size(); ++pageIndex) {
		const auto& page = pages[pageIndex];
		m_pageSelections.push_back(page.initialKey);
		f32 maxUnits = 0;
		for (const auto& row : page.rows) maxUnits = std::max(maxUnits, row.units);
		for (size_t rowIndex = 0; rowIndex < page.rows.size(); ++rowIndex) {
			const auto& row = page.rows[rowIndex];
			f32 units = 0;
			for (size_t column = 0; column < row.keys.size(); ++column) {
				const size_t key = static_cast<size_t>(row.keys[column]);
				m_pageKeyRows[pageIndex][key] = static_cast<i16>(rowIndex);
				m_pageKeyCenters[pageIndex][key] = maxUnits - row.units + units * 2 + row.spans[column];
				units += row.spans[column];
			}
		}
	}
	m_selectedRow = m_pageKeyRows[0][static_cast<size_t>(m_selected)];
}
size_t OnScreenKeyboard::allocateSource() {
	const size_t source = m_sourceKeys.size();
	m_sourceKeys.push_back(-1); m_sourceModifiers.push_back(0);
	m_sourceModifierTapEligible.push_back(0); m_sourceModifierTapGeneration.push_back(0);
	return source;
}
void OnScreenKeyboard::open() {
	m_visible = true; m_page = KeyboardPage::Text;
	for (size_t page = 0; page < m_pages.size(); ++page) m_pageSelections[page] = m_pages[page].initialKey;
	m_selected = m_pageSelections[0]; m_selectedRow = m_pageKeyRows[static_cast<size_t>(m_page)][static_cast<size_t>(m_selected)];
	m_feedbackUntilMs.fill(0); m_nextFeedbackExpiryMs = std::numeric_limits<f64>::infinity();
	++m_revision;
}
void OnScreenKeyboard::close() {
	for (size_t source = 0; source < m_sourceKeys.size(); ++source) releaseKeySource(source);
	for (size_t modifier = 0; modifier < MODIFIER_USAGES.size(); ++modifier) {
		m_modifierStates[modifier] = false; publishModifier(modifier);
	}
	m_visible = false; m_feedbackUntilMs.fill(0); m_nextFeedbackExpiryMs = std::numeric_limits<f64>::infinity();
	++m_revision;
}
void OnScreenKeyboard::setPage(KeyboardPage page) {
	if (page == m_page) return;
	m_page = page; m_selected = m_pageSelections[static_cast<size_t>(page)]; m_selectedRow = m_pageKeyRows[static_cast<size_t>(m_page)][static_cast<size_t>(m_selected)];
	++m_revision;
}
void OnScreenKeyboard::selectKey(i16 key, KeyboardPage page) {
	if (m_pageSelections[static_cast<size_t>(page)] == key) return;
	m_pageSelections[static_cast<size_t>(page)] = key;
	if (page == m_page) { m_selected = key; m_selectedRow = m_pageKeyRows[static_cast<size_t>(m_page)][static_cast<size_t>(key)]; }
	++m_revision;
}
void OnScreenKeyboard::moveHorizontal(i32 direction) {
	const auto& row = rows()[static_cast<size_t>(m_selectedRow)];
	const i32 offset = static_cast<i32>(std::find(row.keys.begin(), row.keys.end(), m_selected) - row.keys.begin());
	const i32 count = static_cast<i32>(row.keys.size());
	selectKey(row.keys[static_cast<size_t>((offset + count + direction) % count)], m_page);
}
void OnScreenKeyboard::moveVertical(i32 direction) {
	const auto pageRows = rows();
	const auto& centers = m_pageKeyCenters[static_cast<size_t>(m_page)];
	const f32 center = centers[static_cast<size_t>(m_selected)];
	const i32 rowIndex = (m_selectedRow + static_cast<i32>(pageRows.size()) + direction) % static_cast<i32>(pageRows.size());
	const auto& row = pageRows[static_cast<size_t>(rowIndex)];
	i16 closest = row.keys[0];
	f32 distance = std::abs(centers[static_cast<size_t>(closest)] - center);
	for (size_t index = 1; index < row.keys.size(); ++index) {
		const f32 next = std::abs(centers[static_cast<size_t>(row.keys[index])] - center);
		if (next < distance) { closest = row.keys[index]; distance = next; }
	}
	selectKey(closest, m_page);
}
void OnScreenKeyboard::activate(size_t source) { activateKey(source, m_selected); }
void OnScreenKeyboard::activateKey(size_t source, i16 key) {
	const i32 modifier = ON_SCREEN_KEY_DEFINITIONS[static_cast<size_t>(key)].modifier;
	if (modifier == kNoModifier) { pressKey(source, key); return; }
	m_modifierStates[static_cast<size_t>(modifier)] = !m_modifierStates[static_cast<size_t>(modifier)];
	publishModifier(static_cast<size_t>(modifier)); ++m_revision;
}
void OnScreenKeyboard::pressKey(size_t source, i16 key) {
	if (m_sourceKeys[source] == key) return;
	releaseKeySource(source); m_sourceKeys[source] = key;
	const auto& definition = ON_SCREEN_KEY_DEFINITIONS[static_cast<size_t>(key)];
	if (definition.modifier != kNoModifier) {
		m_sourceModifierTapEligible[source] = m_ordinaryHeldSources == 0 ? 1 : 0;
		m_sourceModifierTapGeneration[source] = m_ordinaryPressGeneration;
		++m_keyCounts[static_cast<size_t>(key)]; publishModifier(static_cast<size_t>(definition.modifier));
	} else {
		++m_ordinaryHeldSources; ++m_ordinaryPressGeneration;
		u8 modifiers = 0;
		for (size_t modifier = 0; modifier < MODIFIER_USAGES.size(); ++modifier) {
			if (m_modifierStates[modifier]) { modifiers |= 1u << modifier; ++m_modifierCounts[modifier]; }
		}
		m_sourceModifiers[source] = modifiers;
		if (++m_keyCounts[static_cast<size_t>(key)] == 1) {
			m_input.setVirtualKeyboardKey(definition.usage, true); recordKeyFeedback(static_cast<size_t>(key), true);
		}
	}
	++m_revision;
}
void OnScreenKeyboard::releaseSource(size_t source, bool completeModifierTap) {
	const i16 key = m_sourceKeys[source];
	if (completeModifierTap && key >= 0 && m_sourceModifierTapEligible[source] != 0
		&& m_sourceModifierTapGeneration[source] == m_ordinaryPressGeneration) {
		const size_t modifier = static_cast<size_t>(ON_SCREEN_KEY_DEFINITIONS[static_cast<size_t>(key)].modifier);
		m_modifierStates[modifier] = !m_modifierStates[modifier];
	}
	if (releaseKeySource(source)) ++m_revision;
}
void OnScreenKeyboard::command(size_t source, OnScreenKeyboardCommand command) {
	switch (command) {
		case OnScreenKeyboardCommand::None: return;
		case OnScreenKeyboardCommand::Activate: activate(source); return;
		case OnScreenKeyboardCommand::Shift: activateKey(source, MODIFIER_KEY_INDICES[kModifierShift]); return;
		case OnScreenKeyboardCommand::TogglePage: setPage(static_cast<KeyboardPage>((static_cast<size_t>(m_page) + 1) % m_pages.size())); return;
		case OnScreenKeyboardCommand::Backspace: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Backspace]); return;
		case OnScreenKeyboardCommand::Delete: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Delete]); return;
		case OnScreenKeyboardCommand::Space: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Space]); return;
		case OnScreenKeyboardCommand::Left: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowLeft]); return;
		case OnScreenKeyboardCommand::Right: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowRight]); return;
		case OnScreenKeyboardCommand::Home: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Home]); return;
		case OnScreenKeyboardCommand::End: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::End]); return;
		case OnScreenKeyboardCommand::Enter: pressKey(source, ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Enter]); return;
	}
}
const char* OnScreenKeyboard::label(i16 key) const {
	const auto& definition = ON_SCREEN_KEY_DEFINITIONS[static_cast<size_t>(key)];
	return shiftActive() && definition.shiftLabel ? definition.shiftLabel : definition.label;
}
bool OnScreenKeyboard::isKeyPressed(i16 key) const {
	const auto modifier = ON_SCREEN_KEY_DEFINITIONS[static_cast<size_t>(key)].modifier;
	return modifier == kNoModifier ? m_keyCounts[static_cast<size_t>(key)] != 0 : m_modifierPressed[static_cast<size_t>(modifier)];
}
bool OnScreenKeyboard::isKeyHighlighted(i16 key) const { return isKeyPressed(key) || m_feedbackUntilMs[static_cast<size_t>(key)] != 0; }
void OnScreenKeyboard::updateFeedback(f64 time) {
	m_feedbackTimeMs = time;
	if (time < m_nextFeedbackExpiryMs) return;
	f64 next = std::numeric_limits<f64>::infinity();
	for (auto& expiry : m_feedbackUntilMs) { if (expiry <= time) expiry = 0; else next = std::min(next, expiry); }
	m_nextFeedbackExpiryMs = next; ++m_revision;
}
bool OnScreenKeyboard::releaseKeySource(size_t source) {
	const i16 key = m_sourceKeys[source];
	if (key < 0) return false;
	m_sourceKeys[source] = -1; m_sourceModifierTapEligible[source] = 0;
	const auto& definition = ON_SCREEN_KEY_DEFINITIONS[static_cast<size_t>(key)];
	--m_keyCounts[static_cast<size_t>(key)];
	if (definition.modifier != kNoModifier) publishModifier(static_cast<size_t>(definition.modifier));
	else {
		--m_ordinaryHeldSources;
		if (m_keyCounts[static_cast<size_t>(key)] == 0) {
			m_input.setVirtualKeyboardKey(definition.usage, false); recordKeyFeedback(static_cast<size_t>(key), false);
		}
	}
	const u8 modifiers = m_sourceModifiers[source]; m_sourceModifiers[source] = 0;
	for (size_t modifier = 0; modifier < MODIFIER_USAGES.size(); ++modifier) {
		if ((modifiers & (1u << modifier)) == 0) continue;
		--m_modifierCounts[modifier];
		if (modifier == kModifierShift && m_modifierCounts[modifier] == 0) m_modifierStates[modifier] = false;
		publishModifier(modifier);
	}
	return true;
}
void OnScreenKeyboard::publishModifier(size_t modifier) {
	const i16 key = MODIFIER_KEY_INDICES[modifier];
	const bool pressed = m_modifierStates[modifier] || m_modifierCounts[modifier] != 0 || m_keyCounts[static_cast<size_t>(key)] != 0;
	if (pressed == m_modifierPressed[modifier]) return;
	m_modifierPressed[modifier] = pressed; m_input.setVirtualKeyboardKey(MODIFIER_USAGES[modifier], pressed); recordKeyFeedback(static_cast<size_t>(key), pressed);
}
void OnScreenKeyboard::recordKeyFeedback(size_t key, bool down) {
	if (down) m_feedbackUntilMs[key] = 0;
	else { const f64 expiry = m_feedbackTimeMs + kReleaseFeedbackMs; m_feedbackUntilMs[key] = expiry; m_nextFeedbackExpiryMs = std::min(m_nextFeedbackExpiryMs, expiry); }
}
} // namespace bmsx
