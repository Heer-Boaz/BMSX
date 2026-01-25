/*
 * inputstatemanager.h - Input state manager for BMSX
 *
 * Manages button state tracking and input buffering for edge detection.
 * Mirrors TypeScript InputStateManager class from input/input.ts
 */

#ifndef BMSX_INPUTSTATEMANAGER_H
#define BMSX_INPUTSTATEMANAGER_H

#include "inputtypes.h"
#include <deque>
#include <unordered_map>

namespace bmsx {

/* ============================================================================
 * InputStateManager
 *
 * Tracks button states and maintains an input buffer for windowed edge
 * detection (waspressed/wasreleased within N milliseconds).
 * ============================================================================ */

class InputStateManager {
public:
	InputStateManager();
	~InputStateManager() = default;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Frame lifecycle
	// ─────────────────────────────────────────────────────────────────────────
	
	// Called at start of each frame - resets edge flags
	void beginFrame(f64 currentTimeMs);
	
	// Called during frame - updates button states and prunes old events
	void update(f64 currentTimeMs);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Event handling
	// ─────────────────────────────────────────────────────────────────────────
	
	// Add an input event to the buffer
	void addInputEvent(InputEvent evt);
	
	// Mark an event as consumed
	void consumeBufferedEvent(const std::string& identifier, std::optional<i32> pressId);
	
	// ─────────────────────────────────────────────────────────────────────────
	// State queries
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get button state, optionally with windowed edge detection
	ButtonState getButtonState(const std::string& button, std::optional<f64> windowMs = std::nullopt) const;
	
	// Check if button was pressed within window
	bool wasPressedInWindow(const std::string& button, f64 windowMs) const;
	
	// Check if button was released within window
	bool wasReleasedInWindow(const std::string& button, f64 windowMs) const;

	// Return latest unconsumed press/release pressId for a button
	std::optional<i32> getLatestUnconsumedPressId(const std::string& button) const;
	std::optional<i32> getLatestUnconsumedReleaseId(const std::string& button) const;
	
	// ─────────────────────────────────────────────────────────────────────────
	// State management
	// ─────────────────────────────────────────────────────────────────────────
	
	// Reset edge state (justpressed/justreleased) without clearing button states
	void resetEdgeState();
	
	// Clear all state
	void clear();
	
private:
	// ─────────────────────────────────────────────────────────────────────────
	// Data members
	// ─────────────────────────────────────────────────────────────────────────
	
	// Buffered input events for windowed detection
	std::deque<InputEvent> m_inputBuffer;
	
	// Current button states
	std::unordered_map<std::string, ButtonState> m_buttonStates;

	// Latest unconsumed press/release ids per button
	std::unordered_map<std::string, i32> m_latestUnconsumedPressIdByButton;
	std::unordered_map<std::string, i32> m_latestUnconsumedReleaseIdByButton;
	
	// Current frame timestamp
	f64 m_currentTimeMs = 0.0;
	
	// Buffer retention time (oldest events to keep)
	static constexpr f64 BUFFER_FRAME_RETENTION = 150.0;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────
	
	void pruneOldEvents();
};

} // namespace bmsx

#endif // BMSX_INPUTSTATEMANAGER_H
