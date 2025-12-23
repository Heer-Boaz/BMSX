/*
 * input_action_effect_compiler.h - Compiler for input action effect programs
 *
 * Mirrors TypeScript action_effects/input_action_effect_compiler.ts
 * Compiles DSL programs into executable predicates and effect executors.
 */

#ifndef BMSX_INPUT_ACTION_EFFECT_COMPILER_H
#define BMSX_INPUT_ACTION_EFFECT_COMPILER_H

#include "input_action_effect_dsl.h"
#include "../core/types.h"
#include "../input/playerinput.h"
#include <functional>
#include <memory>
#include <vector>
#include <any>

namespace bmsx {

// Forward declarations
class WorldObject;
class PlayerInput;
class ActionEffectComponent;
struct GameEvent;

/* ============================================================================
 * Binding execution environment
 * ============================================================================ */

struct BindingExecutionEnv {
	WorldObject* owner;
	std::string ownerId;
	i32 playerIndex;
	PlayerInput* input;
	ActionEffectComponent* effects;
	std::vector<GameEvent> queuedEvents;
};

/* ============================================================================
 * Function types
 * ============================================================================ */

using PatternPredicate = std::function<bool(PlayerInput*)>;
using EffectExecutor = std::function<void(BindingExecutionEnv&)>;
using EnvPredicate = std::function<bool(const BindingExecutionEnv&)>;
using PatternParser = std::function<PatternPredicate(const std::string&)>;

/* ============================================================================
 * Compiled custom edge
 * ============================================================================ */

struct CompiledCustomEdge {
	std::string name;
	PatternPredicate match;
	std::optional<EffectExecutor> effect;
};

/* ============================================================================
 * Compiled binding
 * ============================================================================ */

struct CompiledBinding {
	std::optional<std::string> name;
	i32 priority = 0;
	EnvPredicate predicate;
	std::optional<PatternPredicate> press;
	std::optional<PatternPredicate> hold;
	std::optional<PatternPredicate> release;
	std::optional<EffectExecutor> pressEffect;
	std::optional<EffectExecutor> holdEffect;
	std::optional<EffectExecutor> releaseEffect;
	std::vector<CompiledCustomEdge> customEdges;
	bool usesEffectTriggers = false;
};

/* ============================================================================
 * Compiled program
 * ============================================================================ */

struct CompiledProgram {
	ProgramEvalMode evalMode = ProgramEvalMode::First;
	i32 priority = 0;
	std::vector<CompiledBinding> bindings;
	bool usesEffectTriggers = false;
};

/* ============================================================================
 * Compiler functions
 * ============================================================================ */

CompiledProgram compileProgram(
	const InputActionEffectProgram& program,
	const PatternParser& parse
);

CompiledBinding compileBinding(
	const Binding& binding,
	const PatternParser& parse
);

/* ============================================================================
 * Validation
 * ============================================================================ */

void validateProgramEffects(
	const InputActionEffectProgram& program,
	const std::string& programId
);

} // namespace bmsx

#endif // BMSX_INPUT_ACTION_EFFECT_COMPILER_H
