/*
 * pointer.h - Pointer input handler for BMSX
 */

#ifndef BMSX_POINTERINPUT_H
#define BMSX_POINTERINPUT_H

#include "models.h"
#include <unordered_map>

namespace bmsx {

class PointerInput : public InputHandler {
public:
	static constexpr i32 VIRTUAL_POINTER_INDEX = 0x7fffffff;

	explicit PointerInput(const std::string& deviceId = "pointer:0");
	~PointerInput() override;

	void pollInput() override;
	ButtonState getButtonState(const ButtonId& button) override;
	void consumeButton(const ButtonId& button) override;
	void reset(const std::vector<std::string>* except = nullptr) override;
	i32 gamepadIndex() const override { return VIRTUAL_POINTER_INDEX; }
	bool supportsVibrationEffect() const override { return false; }
	void applyVibrationEffect(const VibrationParams& /*params*/) override {}
	void dispose() override;

	void ingestButton(const std::string& code, bool down, f32 value, f64 timestamp, std::optional<i32> pressId = std::nullopt);
	void ingestAxis2(const std::string& code, f32 x, f32 y, f64 timestamp);
	void ingestAxis1(const std::string& code, f32 value, f64 timestamp);

private:
	std::string m_deviceId;
	std::unordered_map<std::string, ButtonState> m_buttonStates;
	i32 m_nextPressId = 1;
	f32 m_lastPositionX = 0.0f;
	f32 m_lastPositionY = 0.0f;
	bool m_lastPositionValid = false;
	f64 m_lastPollTimeMs = 0.0;
	f64 m_lastDeltaTimestamp = 0.0;
	f64 m_lastWheelTimestamp = 0.0;
};

} // namespace bmsx

#endif // BMSX_POINTERINPUT_H
