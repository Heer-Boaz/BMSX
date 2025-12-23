/*
 * input_action_effect_system.h - ECS system for input action effect processing
 *
 * Mirrors TypeScript ecs/input_action_effect_system.ts
 * Processes InputIntentComponent and InputActionEffectComponent to trigger effects.
 */

#ifndef BMSX_INPUT_ACTION_EFFECT_SYSTEM_H
#define BMSX_INPUT_ACTION_EFFECT_SYSTEM_H

#include "../ecs/ecsystem.h"
#include "../action_effects/input_action_effect_compiler.h"
#include "../action_effects/input_action_effect_dsl.h"
#include "../component/inputintentcomponent.h"
#include "../component/inputactioneffectcomponent.h"
#include <unordered_map>
#include <unordered_set>
#include <memory>

namespace bmsx {

/* ============================================================================
 * InputActionEffectSystem
 *
 * Processes input intent bindings and action effect programs.
 * Runs in TickGroup::Input to ensure consumed events are visible to FSM.
 * ============================================================================ */

class InputActionEffectSystem : public ECSystem {
public:
	explicit InputActionEffectSystem(i32 priority = 0);
	~InputActionEffectSystem() override = default;

	void update(World& world) override;

private:
	// Compiled program caches
	std::unordered_map<std::string, CompiledProgram> m_compiledById;
	std::unordered_map<const InputActionEffectProgram*, CompiledProgram> m_inlineCompiled;
	std::unordered_set<const InputActionEffectProgram*> m_validatedInlinePrograms;
	std::unordered_map<std::string, InputActionEffectProgram> m_resolvedPrograms;
	std::unordered_set<std::string> m_missingProgramIds;

	// Pattern cache
	std::unordered_map<std::string, PatternPredicate> m_patternCache;
	static constexpr size_t PATTERN_CACHE_MAX = 256;

	// Binding state
	std::unordered_map<std::string, bool> m_bindingLatch;
	std::unordered_set<std::string> m_frameLatchTouched;

	// Scratch buffer for custom edge matching
	std::vector<bool> m_customMatchScratch;

	// Processing methods
	void processInputIntents(World& world);
	void processInputActionPrograms(World& world);

	// Intent processing
	void evaluateIntentBinding(
		WorldObject& owner,
		PlayerInput& input,
		const InputIntentBinding& binding
	);

	void runIntentAssignments(
		WorldObject& owner,
		PlayerInput& input,
		const InputIntentBinding& binding,
		const std::string& edge,
		const InputIntentEdgeAssignment& spec
	);

	void assignOwnerPath(
		WorldObject& owner,
		const std::string& path,
		const std::any& value,
		bool clear
	);

	PlayerInput* resolveIntentPlayerInput(
		InputIntentComponent& component,
		WorldObject& owner
	);

	// Program processing
	std::string resolveProgramKey(
		InputActionEffectComponent& component,
		WorldObject& owner
	);

	std::string describeInlineProgram(InputActionEffectComponent& component);

	bool isEligibleObject(WorldObject& obj);

	void evaluateProgram(
		const CompiledProgram& program,
		BindingExecutionEnv& env,
		const std::string& programKey
	);

	std::string makeBindingKey(
		const std::string& ownerId,
		const std::string& programKey,
		i32 playerIndex,
		const CompiledBinding& binding,
		size_t index
	);

	void ensureScratch(size_t size);

	CompiledProgram& resolveCompiledProgram(InputActionEffectComponent& component);
	InputActionEffectProgram& resolveProgramById(const std::string& programId);
	PatternPredicate parsePattern(const std::string& pattern);
};

} // namespace bmsx

#endif // BMSX_INPUT_ACTION_EFFECT_SYSTEM_H
