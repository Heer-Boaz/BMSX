/*
 * inputintentcomponent.h - Input intent component for declarative input bindings
 *
 * Mirrors TypeScript component/inputintentcomponent.ts
 * Provides a declarative way to map input actions to property assignments.
 */

#ifndef BMSX_INPUT_INTENT_COMPONENT_H
#define BMSX_INPUT_INTENT_COMPONENT_H

#include "component.h"
#include "../core/types.h"
#include <string>
#include <vector>
#include <any>
#include <optional>

namespace bmsx {

/* ============================================================================
 * Intent assignment types
 * ============================================================================ */

struct IntentAssignment {
	std::string path;                   // Property path on owner (dot notation)
	std::optional<std::any> value;      // Value to assign (defaults to true on press/hold)
	bool clear = false;                 // When true, delete instead of assign
	bool consume = false;               // Consume the action after assignment
};

using InputIntentEdgeAssignment = std::vector<IntentAssignment>;

/* ============================================================================
 * Input intent binding
 * ============================================================================ */

struct InputIntentBinding {
	std::string action;
	InputIntentEdgeAssignment press;
	InputIntentEdgeAssignment hold;
	InputIntentEdgeAssignment release;
};

/* ============================================================================
 * InputIntentComponent
 *
 * Declaratively binds input actions to property assignments.
 * Processed by InputActionEffectSystem.
 * ============================================================================ */

class InputIntentComponent : public Component {
public:
	static bool unique() { return true; }
	static const char* typeName() { return "InputIntentComponent"; }
	const char* name() const override { return typeName(); }

	// Player index driving this object (falls back to object's player_index)
	i32 playerIndex = 1;

	// Declarative list of intent bindings
	std::vector<InputIntentBinding> bindings;

	explicit InputIntentComponent(const ComponentAttachOptions& opts)
		: Component(opts) {}
	~InputIntentComponent() override = default;
};

} // namespace bmsx

#endif // BMSX_INPUT_INTENT_COMPONENT_H
