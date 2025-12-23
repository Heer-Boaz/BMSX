/*
 * inputactioneffectcomponent.h - Input action effect component
 *
 * Mirrors TypeScript component/inputactioneffectcomponent.ts
 * References an InputActionEffectProgram to process input patterns and trigger effects.
 */

#ifndef BMSX_INPUT_ACTION_EFFECT_COMPONENT_H
#define BMSX_INPUT_ACTION_EFFECT_COMPONENT_H

#include "component.h"
#include "../core/types.h"
#include <string>
#include <memory>

namespace bmsx {

// Forward declaration
struct InputActionEffectProgram;

/* ============================================================================
 * InputActionEffectComponent
 *
 * References an input action effect program by ID or inline.
 * Processed by InputActionEffectSystem to match input patterns and trigger effects.
 * ============================================================================ */

class InputActionEffectComponent : public Component {
public:
	static bool unique() { return true; }
	static const char* typeName() { return "InputActionEffectComponent"; }
	const char* name() const override { return typeName(); }

	// Program identifier that resolves to a ROM data asset
	std::string programId;
	
	// Optional inlined program definition
	std::shared_ptr<InputActionEffectProgram> program;

	explicit InputActionEffectComponent(const ComponentAttachOptions& opts)
		: Component(opts) {}
	~InputActionEffectComponent() override = default;
};

} // namespace bmsx

#endif // BMSX_INPUT_ACTION_EFFECT_COMPONENT_H
