/*
 * playerinput.h - Per-player input handling for BMSX
 *
 * Manages input for a single player, including action state evaluation,
 * input mapping, and context stacking.
 *
 * Mirrors TypeScript input/playerinput.ts
 */

#ifndef BMSX_PLAYERINPUT_H
#define BMSX_PLAYERINPUT_H

#include "inputtypes.h"
#include "inputstatemanager.h"
#include "context.h"
#include <memory>
#include <array>

namespace bmsx {

/* ============================================================================
 * PlayerInput
 *
 * Handles input for a single player, aggregating input from multiple
 * sources (keyboard, gamepad, pointer) and evaluating actions.
 * ============================================================================ */

class PlayerInput {
public:
	// ─────────────────────────────────────────────────────────────────────────
	// Constructor / Destructor
	// ─────────────────────────────────────────────────────────────────────────
	explicit PlayerInput(i32 playerIndex);
	~PlayerInput();
	
	// Non-copyable
	PlayerInput(const PlayerInput&) = delete;
	PlayerInput& operator=(const PlayerInput&) = delete;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Player identity
	// ─────────────────────────────────────────────────────────────────────────
	i32 index() const { return m_playerIndex; }
	
	// ─────────────────────────────────────────────────────────────────────────
	// Input handlers
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get handler for a source
	InputHandler* getHandler(InputSource source) const;
	
	// Set handler for a source
	void setHandler(InputSource source, InputHandler* handler);
	
	// Clear handler for a source
	void clearHandler(InputSource source);
	
	// Assign gamepad to this player
	void assignGamepad(InputHandler* gamepad);
	
	// Clear gamepad if it matches
	void clearGamepad(InputHandler* handler);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Input mapping
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get current input map
	const InputMap* inputMap() const { return &m_inputMap; }
	
	// Set input map
	void setInputMap(const InputMap& map);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Context stacking
	// ─────────────────────────────────────────────────────────────────────────
	
	// Push a mapping context
	void pushContext(const std::string& id, i32 priority, const InputMap& map);
	
	// Pop a mapping context
	void popContext(const std::string& id);
	
	// Enable/disable a context
	void enableContext(const std::string& id, bool enabled);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Action state
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get action state (aggregated from all sources)
	ActionState getActionState(const std::string& action, std::optional<f64> windowMs = std::nullopt);
	
	// Get all currently pressed actions
	std::vector<ActionState> getPressedActions(const PressedActionsQuery* query = nullptr);
	
	// Check if action is triggered (using action parser expression)
	bool checkActionTriggered(const std::string& actionDef);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Button state
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get button state from specific source
	ButtonState getButtonState(const std::string& button, InputSource source);
	
	// Get button state with repeat handling
	ButtonState getButtonRepeatState(const std::string& button, InputSource source);
	
	// Get key state with modifier requirements
	ButtonState getKeyState(const std::string& key, KeyModifier modifiers);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Modifiers
	// ─────────────────────────────────────────────────────────────────────────
	
	struct ModifierState {
		bool shift = false;
		bool ctrl = false;
		bool alt = false;
		bool meta = false;
	};
	
	// Get current modifier key states
	ModifierState getModifiersState();
	
	// Get modifiers as bitmask
	KeyModifier getModifiersMask();
	
	// Convert bitmask to modifier state
	static ModifierState modifiersFromMask(KeyModifier mask);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Consume / Reset
	// ─────────────────────────────────────────────────────────────────────────
	
	// Consume an action (prevent further detection)
	void consumeAction(const std::string& action);
	void consumeAction(const ActionState& action);
	
	// Consume a button
	void consumeButton(const std::string& button, InputSource source);
	
	// Consume multiple actions
	template<typename... Args>
	void consumeActions(Args&&... actions) {
		(consumeAction(std::forward<Args>(actions)), ...);
	}
	
	// ─────────────────────────────────────────────────────────────────────────
	// Frame lifecycle
	// ─────────────────────────────────────────────────────────────────────────
	
	// Poll all input sources
	void pollInput(f64 currentTimeMs);
	
	// Update state (called after polling)
	void update(f64 currentTimeMs);
	
	// Current frame counter
	i64 pollFrame() const { return m_frameCounter; }
	
	// ─────────────────────────────────────────────────────────────────────────
	// Reset
	// ─────────────────────────────────────────────────────────────────────────
	
	// Reset all state
	void reset(const std::vector<std::string>* except = nullptr);
	
	// Clear edge state only
	void clearEdgeState();
	
	// ─────────────────────────────────────────────────────────────────────────
	// State manager access
	// ─────────────────────────────────────────────────────────────────────────
	InputStateManager& stateManager() { return m_stateManager; }
	
private:
	// ─────────────────────────────────────────────────────────────────────────
	// Data members
	// ─────────────────────────────────────────────────────────────────────────
	
	i32 m_playerIndex;
	
	// Input handlers by source
	std::array<InputHandler*, INPUT_SOURCE_COUNT> m_handlers = {nullptr, nullptr, nullptr};
	
	// Input mapping
	InputMap m_inputMap;
	
	// Context stack for layered mappings
	ContextStack m_contexts;
	
	// State manager for edge detection
	InputStateManager m_stateManager;
	
	// Guard records for debouncing
	std::unordered_map<std::string, ActionGuardRecord> m_actionGuardRecords;
	
	// Repeat records for repeat pulse
	std::unordered_map<std::string, ActionRepeatRecord> m_actionRepeatRecords;
	
	// Frame counter
	i64 m_frameCounter = 0;
	
	// Last poll timestamp
	std::optional<f64> m_lastPollTimestampMs;
	
	// Current guard window (adaptive to frame rate)
	f64 m_guardWindowMs = ACTION_GUARD_MIN_MS;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get handler array index for source
	static constexpr size_t sourceIndex(InputSource source) {
		return static_cast<size_t>(source);
	}
	
	// Evaluate action guard (debouncing)
	bool evaluateActionGuard(const std::string& action, const ActionState& state, 
								std::optional<f64> windowOverride = std::nullopt);
	
	// Evaluate action repeat
	struct RepeatResult {
		bool triggered = false;
		i32 count = 0;
	};
	RepeatResult evaluateActionRepeat(const std::string& action, const ActionState& state);
	
	// Normalize guard window
	f64 normalizeGuardWindow(std::optional<f64> windowOverride);
	
	// Resolve action timestamp
	f64 resolveActionTimestamp(const ActionState& state);
	
	// Ensure repeat state exists
	ActionRepeatRecord& ensureRepeatState(const std::string& action);
	
	// Get bindings for action from input map + contexts
	template<InputSource Source>
	auto getBindingsForAction(const std::string& action) const;
};

} // namespace bmsx

#endif // BMSX_PLAYERINPUT_H
