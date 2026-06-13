/*
 * player.h - Per-player input handling for BMSX
 *
 * Host-side per-player input view: buffered button state, raw-button repeat
 * cadence, and vibration output used by the host overlay/IDE. The machine ICU
 * reads a raw snapshot directly from the device handlers.
 */

#ifndef BMSX_PLAYERINPUT_H
#define BMSX_PLAYERINPUT_H

#include "models.h"
#include "manager.h"
#include <array>
#include <unordered_set>

namespace bmsx {

/* ============================================================================
 * PlayerInput
 *
 * Handles input for a single player across multiple sources (keyboard,
 * gamepad, pointer).
 * ============================================================================ */

class PlayerInput {
public:
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

	void assignGamepadToPlayer(InputHandler* gamepad);
	void clearGamepad(InputHandler* handler);

	void applyInputControllerVibrationEffect(f64 durationMs, f32 intensity);

	// ─────────────────────────────────────────────────────────────────────────
	// Button state
	// ─────────────────────────────────────────────────────────────────────────

	// Simulation-frame button state from the per-source buffer (consume-aware).
	ButtonState getButtonState(const std::string& button, InputSource source, std::optional<i32> windowFrames = std::nullopt);

	// Live button state straight from the device handler.
	ButtonState getRawButtonState(const std::string& button, InputSource source);

	// Raw button state with the built-in repeat cadence applied.
	ActionState getButtonRepeatState(const std::string& button, InputSource source);

	// ─────────────────────────────────────────────────────────────────────────
	// Modifiers
	// ─────────────────────────────────────────────────────────────────────────

	struct ModifierState {
		bool shift = false;
		bool ctrl = false;
		bool alt = false;
		bool meta = false;
	};

	ModifierState getModifiersState();

	// ─────────────────────────────────────────────────────────────────────────
	// Consume
	// ─────────────────────────────────────────────────────────────────────────

	void consumeRawButton(const std::string& button, InputSource source);

	// ─────────────────────────────────────────────────────────────────────────
	// Frame lifecycle
	// ─────────────────────────────────────────────────────────────────────────

	void beginFrame(f64 currentTimeMs);

	void recordButtonEvent(InputSource source, const std::string& button, InputEvent evt);
	void recordAxis1Input(InputSource source, const std::string& button, f32 value, f64 timestamp);
	void recordAxis2Input(InputSource source, const std::string& button, f32 x, f32 y, f64 timestamp);

	void pollInput(f64 currentTimeMs);
	i64 pollFrame() const { return m_frameCounter; }
	void setFrameDurationMs(f64 frameDurationMs) { m_frameDurationMs = frameDurationMs; }

	void update(f64 currentTimeMs);

	void reset(const std::vector<std::string>* except = nullptr);
	void clearEdgeState();

private:
	std::array<InputStateManager, INPUT_SOURCE_COUNT> m_stateManagers;
	std::array<std::unordered_set<std::string>, INPUT_SOURCE_COUNT> m_trackedButtons;
	std::unordered_map<std::string, RawActionRepeatRecord> m_rawActionRepeatRecords;

	i64 m_frameCounter = 0;
	std::optional<f64> m_lastPollTimestampMs;
	f64 m_frameDurationMs = 1000.0 / 60.0;

	static constexpr size_t sourceIndex(InputSource source) {
		return static_cast<size_t>(source);
	}

	InputStateManager& getStateManager(InputSource source) { return m_stateManagers[sourceIndex(source)]; }
	void consumeGameplayButton(const std::string& button, InputSource source);

	struct RepeatResult {
		bool triggered = false;
		i32 count = 0;
	};
	RepeatResult evaluateRawActionRepeat(const std::string& action, const ButtonState& state, i64 frameId);
	RawActionRepeatRecord& ensureRawRepeatState(const std::string& action);
};

} // namespace bmsx

#endif // BMSX_PLAYERINPUT_H
