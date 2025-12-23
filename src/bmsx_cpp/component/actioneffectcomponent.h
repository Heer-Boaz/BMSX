/*
 * actioneffectcomponent.h - Action effect component for triggering gameplay effects
 *
 * Mirrors TypeScript component/actioneffectcomponent.ts
 * Manages effect definitions, cooldowns, and event emission.
 */

#ifndef BMSX_ACTION_EFFECT_COMPONENT_H
#define BMSX_ACTION_EFFECT_COMPONENT_H

#include "component.h"
#include "../core/types.h"
#include <string>
#include <unordered_map>
#include <functional>
#include <optional>
#include <any>

namespace bmsx {

// Forward declarations
class WorldObject;

/* ============================================================================
 * Action effect types
 * ============================================================================ */

using ActionEffectId = std::string;

struct ActionEffectHandlerContext {
	WorldObject* owner;
	std::any payload;
};

struct ActionEffectHandlerResult {
	std::optional<std::string> event;
	std::optional<std::any> payload;
};

using ActionEffectHandler = std::function<ActionEffectHandlerResult(const ActionEffectHandlerContext&)>;

struct ActionEffectDefinition {
	ActionEffectId id;
	std::string event;                          // Default event name to emit
	std::optional<f64> cooldownMs;              // Cooldown in milliseconds
	ActionEffectHandler handler;                // Optional handler function
	std::function<void(const std::any&)> validator;  // Optional payload validator
};

enum class ActionEffectTriggerResult {
	Ok,
	Failed,
	OnCooldown
};

/* ============================================================================
 * ActionEffectComponent
 *
 * Manages action effects for a WorldObject.
 * Supports cooldowns, event emission, and custom handlers.
 * ============================================================================ */

class ActionEffectComponent : public Component {
public:
	static bool unique() { return true; }
	static const char* typeName() { return "ActionEffectComponent"; }
	const char* name() const override { return typeName(); }

	explicit ActionEffectComponent(const ComponentAttachOptions& opts);
	~ActionEffectComponent() override = default;

	// Time management (advanced by ActionEffectRuntimeSystem)
	void advanceTime(f64 dtMs);

	// Effect management
	void grantEffect(const ActionEffectDefinition& definition);
	void grantEffectById(const ActionEffectId& id);
	void revokeEffect(const ActionEffectId& id);
	bool hasEffect(const ActionEffectId& id) const;

	// Effect triggering
	ActionEffectTriggerResult trigger(const ActionEffectId& id, const std::any& payload = {});

	// Cooldown query
	std::optional<f64> cooldownRemaining(const ActionEffectId& id) const;

private:
	std::unordered_map<ActionEffectId, ActionEffectDefinition> m_definitions;
	std::unordered_map<ActionEffectId, f64> m_cooldownUntil;
	f64 m_timeMs = 0.0;

	ActionEffectHandlerResult invokeHandler(
		const ActionEffectDefinition& definition,
		WorldObject* owner,
		const std::any& payload
	);
};

/* ============================================================================
 * ActionEffectRegistry (global registry for effect definitions)
 * ============================================================================ */

class ActionEffectRegistry {
public:
	static ActionEffectRegistry& instance();

	void registerEffect(const ActionEffectDefinition& definition);
	const ActionEffectDefinition* get(const ActionEffectId& id) const;
	void validate(const ActionEffectId& id, const std::any& payload) const;
	bool has(const ActionEffectId& id) const;

private:
	ActionEffectRegistry() = default;
	std::unordered_map<ActionEffectId, ActionEffectDefinition> m_effects;
};

} // namespace bmsx

#endif // BMSX_ACTION_EFFECT_COMPONENT_H
