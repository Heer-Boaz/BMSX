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
 * detection (waspressed/wasreleased within N simulation frames).
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
	ButtonState getButtonState(const std::string& button, std::optional<i32> windowFrames = std::nullopt) const;
	
	// Check if button was pressed within window
	bool wasPressedInWindow(const std::string& button, i32 windowFrames) const;
	
	// Check if button was released within window
	bool wasReleasedInWindow(const std::string& button, i32 windowFrames) const;

	// Return latest unconsumed press/release pressId for a button while the event still exists in the retained buffer.
	std::optional<i32> getLatestUnconsumedPressId(const std::string& button) const;
	std::optional<i32> getLatestUnconsumedReleaseId(const std::string& button) const;
	bool hasTrackedButton(const std::string& button) const;
	
	// ─────────────────────────────────────────────────────────────────────────
	// State management
	// ─────────────────────────────────────────────────────────────────────────
	
	// Reset edge state (justpressed/justreleased) without clearing button states
	void resetEdgeState();
	
	// Clear all state
	void clear();
	
private:
	struct BufferedInputEvent {
		InputEvent event;
		i64 frame = -1;
	};

	struct BufferedEdgeRecord {
		i32 edgeId = -1;
		i64 frame = -1;
		bool consumed = false;
	};

	// ─────────────────────────────────────────────────────────────────────────
	// Data members
	// ─────────────────────────────────────────────────────────────────────────
	
	// Buffered input events for windowed detection
	std::deque<BufferedInputEvent> m_inputBuffer;
	
	// Current button states
	std::unordered_map<std::string, ButtonState> m_buttonStates;

	// Latest buffered press/release edge per button
	std::unordered_map<std::string, BufferedEdgeRecord> m_bufferedPressEdges;
	std::unordered_map<std::string, BufferedEdgeRecord> m_bufferedReleaseEdges;

	i64 m_currentFrame = 0;
	
	// Current frame timestamp
	f64 m_currentTimeMs = 0.0;
	
	// Buffer retention in simulation frames.
	static constexpr i32 BUFFER_FRAME_RETENTION = 150;
	static constexpr i32 RECENT_BUFFERED_EDGE_FRAMES = 2;

	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────
	
	std::optional<i32> getLatestUnconsumedEdgeId(const std::string& button, InputEvent::Type eventType) const;
	std::optional<BufferedEdgeRecord> getBufferedEdgeRecord(const std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap, const std::string& button, i32 windowFrames) const;
	bool isBufferedFrameInWindow(i64 frame, i32 windowFrames) const;
	void pruneOldEvents();
	void pruneBufferedEdges(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap);
};

} // namespace bmsx

#endif // BMSX_INPUTSTATEMANAGER_H
