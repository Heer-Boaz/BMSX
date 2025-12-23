/*
 * input_action_effect_dsl.h - DSL types for input action effect programs
 *
 * Mirrors TypeScript action_effects/input_action_effect_dsl.ts
 * Defines the structure for declarative input-to-effect mapping programs.
 */

#ifndef BMSX_INPUT_ACTION_EFFECT_DSL_H
#define BMSX_INPUT_ACTION_EFFECT_DSL_H

#include "../core/types.h"
#include <string>
#include <vector>
#include <variant>
#include <optional>
#include <any>
#include <memory>

namespace bmsx {

/* ============================================================================
 * Mode predicate
 * ============================================================================ */

struct ModePredicate {
	std::string path;
	bool negate = false;  // 'not' in TypeScript
};

/* ============================================================================
 * When clause
 * ============================================================================ */

struct WhenClause {
	std::vector<ModePredicate> mode;
};

/* ============================================================================
 * On clause (input patterns)
 * ============================================================================ */

struct CustomPatternEntry {
	std::string name;
	std::string pattern;
};

struct OnClause {
	std::optional<std::string> press;
	std::optional<std::string> hold;
	std::optional<std::string> release;
	std::vector<CustomPatternEntry> custom;
};

/* ============================================================================
 * Effect trigger descriptor
 * ============================================================================ */

struct ActionEffectTriggerDescriptor {
	std::string id;
	std::optional<std::any> payload;
};

/* ============================================================================
 * Emit gameplay descriptor
 * ============================================================================ */

struct EmitGameplayDescriptor {
	std::string event;
	std::optional<std::any> payload;
};

/* ============================================================================
 * Effect types
 * ============================================================================ */

struct EffectTrigger {
	std::variant<std::string, ActionEffectTriggerDescriptor> trigger;
};

struct InputConsume {
	std::vector<std::string> actions;
};

struct GameplayEmit {
	EmitGameplayDescriptor descriptor;
};

// Forward declaration for nested commands
struct Effect;

struct NestedCommands {
	std::vector<std::shared_ptr<Effect>> commands;
};

// Effect variant
using EffectVariant = std::variant<EffectTrigger, InputConsume, GameplayEmit, NestedCommands>;

struct Effect {
	EffectVariant value;
	
	// Helper constructors
	static Effect makeTrigger(const std::string& id) {
		Effect e;
		e.value = EffectTrigger{id};
		return e;
	}
	
	static Effect makeTrigger(const ActionEffectTriggerDescriptor& desc) {
		Effect e;
		e.value = EffectTrigger{desc};
		return e;
	}
	
	static Effect makeInputConsume(const std::vector<std::string>& actions) {
		Effect e;
		e.value = InputConsume{actions};
		return e;
	}
	
	static Effect makeGameplayEmit(const EmitGameplayDescriptor& desc) {
		Effect e;
		e.value = GameplayEmit{desc};
		return e;
	}
};

/* ============================================================================
 * Effect table
 * ============================================================================ */

struct EffectTable {
	std::vector<std::shared_ptr<Effect>> press;
	std::vector<std::shared_ptr<Effect>> hold;
	std::vector<std::shared_ptr<Effect>> release;
	std::unordered_map<std::string, std::vector<std::shared_ptr<Effect>>> custom;
};

/* ============================================================================
 * Binding
 * ============================================================================ */

struct Binding {
	std::optional<std::string> name;
	i32 priority = 0;
	std::optional<WhenClause> when;
	OnClause on;
	EffectTable go;
};

/* ============================================================================
 * Input action effect program
 * ============================================================================ */

enum class ProgramEvalMode {
	First,  // Stop after first matching binding
	All     // Evaluate all matching bindings
};

struct InputActionEffectProgram {
	ProgramEvalMode evalMode = ProgramEvalMode::First;
	i32 priority = 0;
	std::vector<Binding> bindings;
};

/* ============================================================================
 * Validation helper
 * ============================================================================ */

bool isInputActionEffectProgram(const std::any& value);

} // namespace bmsx

#endif // BMSX_INPUT_ACTION_EFFECT_DSL_H
