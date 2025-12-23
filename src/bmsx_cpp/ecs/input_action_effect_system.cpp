/*
 * input_action_effect_system.cpp - InputActionEffectSystem implementation
 */

#include "input_action_effect_system.h"
#include "../component/inputintentcomponent.h"
#include "../component/inputactioneffectcomponent.h"
#include "../component/actioneffectcomponent.h"
#include "../core/world.h"
#include "../core/engine.h"
#include "../input/input.h"

namespace bmsx {

/* ============================================================================
 * Static validation on boot
 * ============================================================================ */

static bool s_assetProgramsValidated = false;

static void validatePrimaryAssetsOnBoot() {
	if (s_assetProgramsValidated) return;
	
	// Would iterate over asset data and validate programs
	// For now, just mark as validated
	s_assetProgramsValidated = true;
}

/* ============================================================================
 * Constructor
 * ============================================================================ */

InputActionEffectSystem::InputActionEffectSystem(i32 priority)
	: ECSystem(TickGroup::Input, priority)
{
	ecsId = "inputActionEffectSystem";
	validatePrimaryAssetsOnBoot();
}

/* ============================================================================
 * Update
 * ============================================================================ */

void InputActionEffectSystem::update(World& world) {
	m_frameLatchTouched.clear();
	
	processInputIntents(world);
	processInputActionPrograms(world);
	
	// Clean up latches that weren't touched this frame
	std::vector<std::string> toRemove;
	for (const auto& [key, _] : m_bindingLatch) {
		if (m_frameLatchTouched.find(key) == m_frameLatchTouched.end()) {
			toRemove.push_back(key);
		}
	}
	for (const std::string& key : toRemove) {
		m_bindingLatch.erase(key);
	}
}

/* ============================================================================
 * Input intent processing
 * ============================================================================ */

void InputActionEffectSystem::processInputIntents(World& world) {
	for (auto& [obj, component] : world.objectsWithComponents<InputIntentComponent>()) {
		if (!isEligibleObject(*obj)) continue;
		if (component->bindings.empty()) continue;
		
		PlayerInput* input = resolveIntentPlayerInput(*component, *obj);
		if (!input) continue;
		
		for (const InputIntentBinding& binding : component->bindings) {
			evaluateIntentBinding(*obj, *input, binding);
		}
	}
}

void InputActionEffectSystem::evaluateIntentBinding(
	WorldObject& owner,
	PlayerInput& input,
	const InputIntentBinding& binding)
{
	const std::string& action = binding.action;
	if (action.empty()) return;
	
	ActionState state = input.getActionState(action);
	
	if (state.justpressed && !binding.press.empty()) {
		runIntentAssignments(owner, input, binding, "press", binding.press);
	}
	if (state.pressed && !binding.hold.empty()) {
		runIntentAssignments(owner, input, binding, "hold", binding.hold);
	}
	if (state.justreleased && !binding.release.empty()) {
		runIntentAssignments(owner, input, binding, "release", binding.release);
	}
}

void InputActionEffectSystem::runIntentAssignments(
	WorldObject& owner,
	PlayerInput& input,
	const InputIntentBinding& binding,
	const std::string& edge,
	const InputIntentEdgeAssignment& spec)
{
	for (const IntentAssignment& assignment : spec) {
		if (assignment.path.empty()) continue;
		
		bool shouldClear = assignment.clear ||
			(!assignment.value.has_value() && edge == "release");
		
		std::any resolvedValue;
		if (shouldClear) {
			resolvedValue = std::any{}; // Empty/undefined
		} else if (!assignment.value.has_value()) {
			resolvedValue = (edge == "hold" || edge == "press") ? std::any(true) : std::any{};
		} else {
			resolvedValue = assignment.value.value();
		}
		
		assignOwnerPath(owner, assignment.path, resolvedValue, shouldClear);
		
		if (assignment.consume) {
			input.consumeAction(binding.action);
		}
	}
}

void InputActionEffectSystem::assignOwnerPath(
	WorldObject& owner,
	const std::string& path,
	const std::any& value,
	bool clear)
{
	// Path parsing and property assignment
	// In C++ this would typically use reflection or a property system
	// For now, we'll just handle simple single-level paths
	
	// Split path by '.'
	std::vector<std::string> segments;
	size_t start = 0;
	size_t pos = 0;
	while ((pos = path.find('.', start)) != std::string::npos) {
		segments.push_back(path.substr(start, pos - start));
		start = pos + 1;
	}
	segments.push_back(path.substr(start));
	
	if (segments.empty()) return;
	
	// Would need reflection/property system to actually set properties
	// For now, this is a placeholder that could be extended
}

PlayerInput* InputActionEffectSystem::resolveIntentPlayerInput(
	InputIntentComponent& component,
	WorldObject& owner)
{
	i32 explicitIndex = component.playerIndex;
	i32 fallback = owner.playerIndex();
	i32 resolved = explicitIndex > 0 ? explicitIndex : fallback;
	
	if (resolved <= 0) {
		throw std::runtime_error(
			"[InputActionEffectSystem] Unable to resolve player index for object '" +
			owner.id + "'."
		);
	}
	
	return Input::instance().getPlayerInput(resolved);
}

/* ============================================================================
 * Input action program processing
 * ============================================================================ */

void InputActionEffectSystem::processInputActionPrograms(World& world) {
	for (auto& [obj, component] : world.objectsWithComponents<InputActionEffectComponent>()) {
		if (!isEligibleObject(*obj)) continue;
		
		CompiledProgram& program = resolveCompiledProgram(*component);
		std::string programKey = resolveProgramKey(*component, *obj);
		
		i32 playerIdx = obj->playerIndex();
		PlayerInput* inputPtr = Input::instance().getPlayerInput(playerIdx);
		if (!inputPtr) continue;
		PlayerInput& input = *inputPtr;
		
		ActionEffectComponent* effects = obj->getFirstComponent<ActionEffectComponent>();
		
		if (!effects && program.usesEffectTriggers) {
			throw std::runtime_error(
				"[InputActionEffectSystem] Program '" + programKey +
				"' triggers effects but object '" + obj->id +
				"' has no ActionEffectComponent."
			);
		}
		
		std::string ownerId = effects ? effects->parent()->id : obj->id;
		
		BindingExecutionEnv env;
		env.owner = obj;
		env.ownerId = ownerId;
		env.playerIndex = playerIdx;
		env.input = &input;
		env.effects = effects;
		
		evaluateProgram(program, env, programKey);
		
		// Dispatch queued events
		StateMachineController* sc = obj->stateController();
		if (sc) {
			for (const GameEvent& evt : env.queuedEvents) {
				sc->dispatch(evt);
			}
		}
	}
}

std::string InputActionEffectSystem::resolveProgramKey(
	InputActionEffectComponent& component,
	WorldObject& owner)
{
	if (!component.programId.empty()) {
		return component.programId;
	}
	return "inline:" + owner.id;
}

std::string InputActionEffectSystem::describeInlineProgram(InputActionEffectComponent& component) {
	std::string ownerId = component.parent() ? component.parent()->id : "<unattached>";
	std::string componentId = !component.id.empty() ? component.id :
		!component.idLocal.empty() ? component.idLocal :
		component.name();
	return "inline:" + ownerId + ":" + componentId;
}

bool InputActionEffectSystem::isEligibleObject(WorldObject& obj) {
	if (obj.disposeFlag()) return false;
	if (!obj.active) return false;
	if (!obj.tickEnabled) return false;
	return true;
}

void InputActionEffectSystem::evaluateProgram(
	const CompiledProgram& program,
	BindingExecutionEnv& env,
	const std::string& programKey)
{
	for (size_t i = 0; i < program.bindings.size(); i++) {
		const CompiledBinding& binding = program.bindings[i];
		
		if (!binding.predicate(env)) continue;
		
		std::string bindingKey = makeBindingKey(
			env.ownerId, programKey, env.playerIndex, binding, i
		);
		
		auto latchIt = m_bindingLatch.find(bindingKey);
		bool armed = (latchIt != m_bindingLatch.end() && latchIt->second);
		if (armed) {
			m_frameLatchTouched.insert(bindingKey);
		}
		
		bool pressMatched = binding.press.has_value() && binding.press.value()(env.input);
		bool holdMatched = binding.hold.has_value() && binding.hold.value()(env.input);
		bool releaseMatched = binding.release.has_value() && binding.release.value()(env.input);
		
		if (!armed && !pressMatched && !holdMatched && !releaseMatched &&
			binding.customEdges.empty()) {
			continue;
		}
		
		// Evaluate custom edges
		ensureScratch(binding.customEdges.size());
		for (size_t j = 0; j < binding.customEdges.size(); j++) {
			m_customMatchScratch[j] = binding.customEdges[j].match(env.input);
		}
		
		bool matched = false;
		
		auto runEffect = [&env](const std::optional<EffectExecutor>& effect) -> bool {
			if (!effect.has_value()) return false;
			effect.value()(env);
			return true;
		};
		
		if (pressMatched) {
			matched = true;
			if (binding.pressEffect.has_value()) {
				if (runEffect(binding.pressEffect)) {
					m_bindingLatch[bindingKey] = true;
					m_frameLatchTouched.insert(bindingKey);
				}
			} else {
				m_bindingLatch[bindingKey] = true;
				m_frameLatchTouched.insert(bindingKey);
			}
		}
		
		if (holdMatched) {
			matched = true;
			runEffect(binding.holdEffect);
			m_bindingLatch[bindingKey] = true;
			m_frameLatchTouched.insert(bindingKey);
		}
		
		if (releaseMatched && armed) {
			if (binding.releaseEffect.has_value()) {
				if (runEffect(binding.releaseEffect)) {
					matched = true;
				}
			} else {
				matched = true;
			}
			m_bindingLatch.erase(bindingKey);
		}
		
		for (size_t j = 0; j < binding.customEdges.size(); j++) {
			if (!m_customMatchScratch[j]) continue;
			
			const auto& effect = binding.customEdges[j].effect;
			if (effect.has_value()) {
				if (runEffect(effect)) matched = true;
			} else {
				matched = true;
			}
		}
		
		if (matched && program.evalMode == ProgramEvalMode::First) {
			return;
		}
	}
}

std::string InputActionEffectSystem::makeBindingKey(
	const std::string& ownerId,
	const std::string& programKey,
	i32 playerIndex,
	const CompiledBinding& binding,
	size_t index)
{
	std::string name = binding.name.value_or("#" + std::to_string(index));
	return ownerId + "|" + programKey + "|p" + std::to_string(playerIndex) +
		"|" + name + "|" + std::to_string(index);
}

void InputActionEffectSystem::ensureScratch(size_t size) {
	if (m_customMatchScratch.size() < size) {
		m_customMatchScratch.resize(size, false);
	}
}

CompiledProgram& InputActionEffectSystem::resolveCompiledProgram(
	InputActionEffectComponent& component)
{
	if (component.program) {
		const InputActionEffectProgram* prog = component.program.get();
		
		// Validate if not already done
		if (m_validatedInlinePrograms.find(prog) == m_validatedInlinePrograms.end()) {
			std::string inlineId = describeInlineProgram(component);
			validateProgramEffects(*prog, inlineId);
			m_validatedInlinePrograms.insert(prog);
		}
		
		auto it = m_inlineCompiled.find(prog);
		if (it != m_inlineCompiled.end()) {
			return it->second;
		}
		
		CompiledProgram compiled = compileProgram(
			*prog,
			[this](const std::string& pattern) { return parsePattern(pattern); }
		);
		m_inlineCompiled[prog] = std::move(compiled);
		return m_inlineCompiled[prog];
	}
	
	const std::string& programId = component.programId;
	if (programId.empty()) {
		std::string hostId = component.parent() ? component.parent()->id : component.id;
		throw std::runtime_error(
			"[InputActionEffectSystem] Component on '" + hostId +
			"' is missing both an inline program and a programId."
		);
	}
	
	auto it = m_compiledById.find(programId);
	if (it != m_compiledById.end()) {
		return it->second;
	}
	
	InputActionEffectProgram& program = resolveProgramById(programId);
	
	CompiledProgram compiled = compileProgram(
		program,
		[this](const std::string& pattern) { return parsePattern(pattern); }
	);
	m_compiledById[programId] = std::move(compiled);
	return m_compiledById[programId];
}

InputActionEffectProgram& InputActionEffectSystem::resolveProgramById(
	const std::string& programId)
{
	auto cachedIt = m_resolvedPrograms.find(programId);
	if (cachedIt != m_resolvedPrograms.end()) {
		return cachedIt->second;
	}
	
	if (m_missingProgramIds.find(programId) != m_missingProgramIds.end()) {
		throw std::runtime_error(
			"[InputActionEffectSystem] Program '" + programId + "' is marked as missing."
		);
	}
	
	// Would load from asset system
	// For now, throw if not found
	m_missingProgramIds.insert(programId);
	throw std::runtime_error(
		"[InputActionEffectSystem] Program '" + programId + "' not found."
	);
}

PatternPredicate InputActionEffectSystem::parsePattern(const std::string& pattern) {
	auto it = m_patternCache.find(pattern);
	if (it != m_patternCache.end()) {
		return it->second;
	}
	
	PatternPredicate predicate = [pattern](PlayerInput* input) {
		return input->checkActionTriggered(pattern);
	};
	
	m_patternCache[pattern] = predicate;
	
	// Evict oldest if cache is full
	if (m_patternCache.size() > PATTERN_CACHE_MAX) {
		// Simple eviction: remove first entry that isn't the new one
		for (auto cacheIt = m_patternCache.begin(); cacheIt != m_patternCache.end(); ++cacheIt) {
			if (cacheIt->first != pattern) {
				m_patternCache.erase(cacheIt);
				break;
			}
		}
	}
	
	return predicate;
}

} // namespace bmsx
