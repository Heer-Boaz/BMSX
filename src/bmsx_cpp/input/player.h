/*
 * player.h - Per-player input handling for BMSX
 *
 * Manages input for a single player, including action state evaluation
 * and context stacking.
 */

#ifndef BMSX_PLAYERINPUT_H
#define BMSX_PLAYERINPUT_H

#include "models.h"
#include "manager.h"
#include "context.h"
#include <memory>
#include <array>
#include <unordered_set>

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
	// Input handlers
	// ─────────────────────────────────────────────────────────────────────────

	i32 playerIndex;
	std::array<InputHandler*, INPUT_SOURCE_COUNT> inputHandlers = {nullptr, nullptr, nullptr};

	// Assign gamepad to this player
	void assignGamepadToPlayer(InputHandler* gamepad);

	// Clear gamepad if it matches
	void clearGamepad(InputHandler* handler);

	// ─────────────────────────────────────────────────────────────────────────
	// Context stacking
	// ─────────────────────────────────────────────────────────────────────────

	// Push a mapping context
	void pushContext(const std::string& id, const KeyboardInputMapping& keyboard, const GamepadInputMapping& gamepad, const PointerInputMapping& pointer, i32 priority = 100, bool enabled = true);

	void clearContext(const std::string& id);

	bool supportsVibrationEffect() const;
	void applyVibrationEffect(const VibrationParams& params);

	// ─────────────────────────────────────────────────────────────────────────
	// Action state
	// ─────────────────────────────────────────────────────────────────────────

	// Get action state (aggregated from all sources); window is in frames.
	ActionState getActionState(const std::string& action, std::optional<f64> windowFrames = std::nullopt);

	// Get all currently pressed actions
	std::vector<ActionState> getPressedActions(const PressedActionsQuery* query = nullptr);

	// Check if action is triggered (using action parser expression)
	bool checkActionTriggered(const std::string& actionDef);

	// ─────────────────────────────────────────────────────────────────────────
	// Button state
	// ─────────────────────────────────────────────────────────────────────────

	// Get button state from specific source
	ButtonState getButtonState(const std::string& button, InputSource source, std::optional<i32> windowFrames = std::nullopt);

	ButtonState getRawButtonState(const std::string& button, InputSource source);

	// Get button state with repeat handling
	ActionState getButtonRepeatState(const std::string& button, InputSource source);

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

	// Consume a button
	void consumeRawButton(const std::string& button, InputSource source);

	// ─────────────────────────────────────────────────────────────────────────
	// Frame lifecycle
	// ─────────────────────────────────────────────────────────────────────────

	// Advance per-simulation-frame edge state
	void beginFrame(f64 currentTimeMs);

	void recordButtonEvent(InputSource source, const std::string& button, InputEvent evt);
	void recordAxis1Input(InputSource source, const std::string& button, f32 value, f64 timestamp);
	void recordAxis2Input(InputSource source, const std::string& button, f32 x, f32 y, f64 timestamp);

	// Poll all input sources
	void pollInput(f64 currentTimeMs);
	i64 pollFrame() const { return m_frameCounter; }
	void setFrameDurationMs(f64 frameDurationMs) { m_frameDurationMs = frameDurationMs; }

	// Update state (called after polling)
	void update(f64 currentTimeMs);

	// ─────────────────────────────────────────────────────────────────────────
	// Reset
	// ─────────────────────────────────────────────────────────────────────────

	// Reset all state
	void reset(const std::vector<std::string>* except = nullptr);

	// Clear edge state only
	void clearEdgeState();

	// ─────────────────────────────────────────────────────────────────────────
private:
	// ─────────────────────────────────────────────────────────────────────────
	// Data members
	// ─────────────────────────────────────────────────────────────────────────

	// Context stack for layered mappings
	ContextStack m_contexts;

	// Per-source state managers for simulation-frame input
	std::array<InputStateManager, INPUT_SOURCE_COUNT> m_stateManagers;
	std::array<std::unordered_set<std::string>, INPUT_SOURCE_COUNT> m_trackedButtons;

	// Guard records for debouncing
	std::unordered_map<std::string, ActionGuardRecord> m_actionGuardRecords;

	std::unordered_map<std::string, SimActionRepeatRecord> m_simActionRepeatRecords;
	std::unordered_map<std::string, RawActionRepeatRecord> m_rawActionRepeatRecords;

	// Host poll frame counter
	i64 m_frameCounter = 0;

	// Last poll timestamp
	std::optional<f64> m_lastPollTimestampMs;

	f64 m_frameDurationMs = 1000.0 / 60.0;

	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────

	// Get handler array index for source
	static constexpr size_t sourceIndex(InputSource source) {
		return static_cast<size_t>(source);
	}

	InputStateManager& getStateManager(InputSource source) { return m_stateManagers[sourceIndex(source)]; }
	const InputStateManager& getStateManager(InputSource source) const { return m_stateManagers[sourceIndex(source)]; }
	i64 simFrame() const { return m_stateManagers[sourceIndex(InputSource::Keyboard)].frame(); }
	void trackContextBindings(const KeyboardInputMapping& keyboard, const GamepadInputMapping& gamepad, const PointerInputMapping& pointer);
	void consumeGameplayButton(const std::string& button, InputSource source);
	void clearActionEvaluationState();

	// Evaluate action guard (debouncing)
	bool evaluateActionGuard(const std::string& action, const ActionState& state,
								std::optional<f64> windowOverride = std::nullopt);

	// Evaluate action repeat
	struct RepeatResult {
		bool triggered = false;
		i32 count = 0;
	};
	RepeatResult evaluateActionRepeat(const std::string& action, const ActionState& state, i64 frameId);
	RepeatResult evaluateRawActionRepeat(const std::string& action, const ButtonState& state, i64 frameId);

	// Normalize guard window
	i64 normalizeGuardWindow(std::optional<f64> windowOverride);

	// Ensure repeat state exists
	SimActionRepeatRecord& ensureSimRepeatState(const std::string& action);
	RawActionRepeatRecord& ensureRawRepeatState(const std::string& action);

};

} // namespace bmsx

#endif // BMSX_PLAYERINPUT_H
