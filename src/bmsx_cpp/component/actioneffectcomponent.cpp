/*
 * actioneffectcomponent.cpp - Action effect component implementation
 */

#include "actioneffectcomponent.h"
#include "../core/world.h"
#include <cmath>

namespace bmsx {

/* ============================================================================
 * ActionEffectComponent implementation
 * ============================================================================ */

ActionEffectComponent::ActionEffectComponent(const ComponentAttachOptions& opts)
	: Component(opts)
	, m_timeMs(0.0)
{
}

void ActionEffectComponent::advanceTime(f64 dtMs) {
	if (!std::isfinite(dtMs)) {
		throw std::runtime_error("[ActionEffectComponent] advanceTime received invalid delta time.");
	}
	
	m_timeMs += dtMs;
	
	if (m_cooldownUntil.empty()) return;
	
	// Expire cooldowns
	std::vector<ActionEffectId> expired;
	for (const auto& [id, until] : m_cooldownUntil) {
		if (m_timeMs >= until) {
			expired.push_back(id);
		}
	}
	for (const ActionEffectId& id : expired) {
		m_cooldownUntil.erase(id);
	}
}

void ActionEffectComponent::grantEffect(const ActionEffectDefinition& definition) {
	if (definition.id.empty()) {
		throw std::runtime_error("[ActionEffectComponent] Cannot grant effect without an id.");
	}
	m_definitions[definition.id] = definition;
}

void ActionEffectComponent::grantEffectById(const ActionEffectId& id) {
	const ActionEffectDefinition* def = ActionEffectRegistry::instance().get(id);
	if (!def) {
		throw std::runtime_error("[ActionEffectComponent] Effect '" + id + "' is not registered.");
	}
	grantEffect(*def);
}

void ActionEffectComponent::revokeEffect(const ActionEffectId& id) {
	m_definitions.erase(id);
	m_cooldownUntil.erase(id);
}

bool ActionEffectComponent::hasEffect(const ActionEffectId& id) const {
	return m_definitions.find(id) != m_definitions.end();
}

ActionEffectTriggerResult ActionEffectComponent::trigger(const ActionEffectId& id, const std::any& payload) {
	auto it = m_definitions.find(id);
	if (it == m_definitions.end()) {
		return ActionEffectTriggerResult::Failed;
	}
	
	const ActionEffectDefinition& definition = it->second;
	
	// Validate payload
	ActionEffectRegistry::instance().validate(id, payload);
	
	// Check cooldown
	auto cdIt = m_cooldownUntil.find(id);
	if (cdIt != m_cooldownUntil.end() && m_timeMs < cdIt->second) {
		return ActionEffectTriggerResult::OnCooldown;
	}
	
	// Get owner
	WorldObject* owner = m_parent;
	if (!owner) {
		throw std::runtime_error("[ActionEffectComponent] Owner not found.");
	}
	
	// Invoke handler
	ActionEffectHandlerResult outcome = invokeHandler(definition, owner, payload);
	
	// Emit event
	std::string eventType = outcome.event.value_or(
		definition.event.empty() ? definition.id : definition.event
	);
	
	// Event emission would go here via owner's event system
	// owner->events().emit(eventType, eventPayload);
	
	// Set cooldown
	if (definition.cooldownMs.has_value() && definition.cooldownMs.value() > 0) {
		m_cooldownUntil[id] = m_timeMs + definition.cooldownMs.value();
	}
	
	return ActionEffectTriggerResult::Ok;
}

std::optional<f64> ActionEffectComponent::cooldownRemaining(const ActionEffectId& id) const {
	auto it = m_cooldownUntil.find(id);
	if (it == m_cooldownUntil.end()) {
		return std::nullopt;
	}
	
	f64 remaining = it->second - m_timeMs;
	if (remaining <= 0) {
		return std::nullopt;
	}
	
	return remaining;
}

ActionEffectHandlerResult ActionEffectComponent::invokeHandler(
	const ActionEffectDefinition& definition,
	WorldObject* owner,
	const std::any& payload)
{
	if (!definition.handler) {
		return {};
	}
	
	ActionEffectHandlerContext ctx{owner, payload};
	return definition.handler(ctx);
}

/* ============================================================================
 * ActionEffectRegistry implementation
 * ============================================================================ */

ActionEffectRegistry& ActionEffectRegistry::instance() {
	static ActionEffectRegistry s_instance;
	return s_instance;
}

void ActionEffectRegistry::registerEffect(const ActionEffectDefinition& definition) {
	if (definition.id.empty()) {
		throw std::runtime_error("[ActionEffectRegistry] Cannot register effect without an id.");
	}
	m_effects[definition.id] = definition;
}

const ActionEffectDefinition* ActionEffectRegistry::get(const ActionEffectId& id) const {
	auto it = m_effects.find(id);
	if (it == m_effects.end()) {
		return nullptr;
	}
	return &it->second;
}

void ActionEffectRegistry::validate(const ActionEffectId& id, const std::any& payload) const {
	const ActionEffectDefinition* def = get(id);
	if (!def) {
		throw std::runtime_error("[ActionEffectRegistry] Effect '" + id + "' is not registered.");
	}
	
	if (def->validator) {
		def->validator(payload);
	}
}

bool ActionEffectRegistry::has(const ActionEffectId& id) const {
	return m_effects.find(id) != m_effects.end();
}

} // namespace bmsx
