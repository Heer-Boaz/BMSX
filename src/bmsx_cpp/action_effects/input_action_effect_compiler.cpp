/*
 * input_action_effect_compiler.cpp - Compiler implementation
 */

#include "input_action_effect_compiler.h"
#include "../component/actioneffectcomponent.h"
#include "../core/world.h"
#include <algorithm>

namespace bmsx {

/* ============================================================================
 * Internal types
 * ============================================================================ */

struct BindingAnalysis {
	bool usesEffectTriggers = false;
};

/* ============================================================================
 * Helper functions
 * ============================================================================ */

static EnvPredicate compilePredicate(const Binding& binding) {
	if (!binding.when.has_value()) {
		return [](const BindingExecutionEnv&) { return true; };
	}
	
	const WhenClause& when = binding.when.value();
	if (when.mode.empty()) {
		return [](const BindingExecutionEnv&) { return true; };
	}
	
	std::vector<ModePredicate> modeItems = when.mode;
	
	return [modeItems](const BindingExecutionEnv& env) {
		for (const ModePredicate& entry : modeItems) {
			if (entry.path.empty()) {
				throw std::runtime_error("[InputActionEffectCompiler] 'mode' clause missing 'path'.");
			}
			
			// Check if owner's state machine matches the path
			StateMachineController* sc = env.owner->stateController();
			bool matches = sc && sc->matchesStatePath(entry.path);
			
			if (entry.negate) {
				if (matches) return false;
			} else if (!matches) {
				return false;
			}
		}
		return true;
	};
}

static std::optional<EffectExecutor> compileEffectList(
	const std::vector<std::shared_ptr<Effect>>& effects,
	const std::string& slot,
	BindingAnalysis& analysis);

static EffectExecutor compileEffect(
	const Effect& effect,
	const std::string& slot,
	BindingAnalysis& analysis)
{
	// Check effect type using std::visit
	return std::visit([&](auto&& arg) -> EffectExecutor {
		using T = std::decay_t<decltype(arg)>;
		
		if constexpr (std::is_same_v<T, EffectTrigger>) {
			analysis.usesEffectTriggers = true;
			
			return std::visit([](auto&& trigger) -> EffectExecutor {
				using TT = std::decay_t<decltype(trigger)>;
				
				if constexpr (std::is_same_v<TT, std::string>) {
					std::string id = trigger;
					return [id](BindingExecutionEnv& env) {
						if (!env.effects) {
							throw std::runtime_error(
								"[InputActionEffectCompiler] Effect trigger '" + id +
								"' attempted without ActionEffectComponent."
							);
						}
						env.effects->trigger(id);
					};
				} else {
					ActionEffectTriggerDescriptor desc = trigger;
					return [desc](BindingExecutionEnv& env) {
						if (!env.effects) {
							throw std::runtime_error(
								"[InputActionEffectCompiler] Effect trigger '" + desc.id +
								"' attempted without ActionEffectComponent."
							);
						}
						env.effects->trigger(desc.id, desc.payload.value_or(std::any{}));
					};
				}
			}, arg.trigger);
		}
		else if constexpr (std::is_same_v<T, InputConsume>) {
			std::vector<std::string> actions = arg.actions;
			if (actions.empty()) {
				throw std::runtime_error(
					"[InputActionEffectCompiler] Empty actions in input.consume effect."
				);
			}
			return [actions](BindingExecutionEnv& env) {
				for (const std::string& action : actions) {
					env.input->consumeAction(action);
				}
			};
		}
		else if constexpr (std::is_same_v<T, GameplayEmit>) {
			EmitGameplayDescriptor desc = arg.descriptor;
			if (desc.event.empty()) {
				throw std::runtime_error(
					"[InputActionEffectCompiler] Missing event name in emit.gameplay effect."
				);
			}
			return [desc](BindingExecutionEnv& env) {
				GameEvent evt;
				evt.type = desc.event;
				// evt.payload = desc.payload; // Would need proper event system
				env.queuedEvents.push_back(evt);
			};
		}
		else if constexpr (std::is_same_v<T, NestedCommands>) {
			std::vector<std::shared_ptr<Effect>> commands;
			for (const auto& cmd : arg.commands) {
				commands.push_back(cmd);
			}
			
			std::vector<EffectExecutor> executors;
			for (const auto& cmd : commands) {
				executors.push_back(compileEffect(*cmd, slot, analysis));
			}
			
			return [executors](BindingExecutionEnv& env) {
				for (const auto& exec : executors) {
					exec(env);
				}
			};
		}
		
		throw std::runtime_error(
			"[InputActionEffectCompiler] Unknown effect in slot '" + slot + "'."
		);
	}, effect.value);
}

static std::optional<EffectExecutor> compileEffectList(
	const std::vector<std::shared_ptr<Effect>>& effects,
	const std::string& slot,
	BindingAnalysis& analysis)
{
	if (effects.empty()) {
		return std::nullopt;
	}
	
	std::vector<EffectExecutor> executors;
	for (const auto& effect : effects) {
		executors.push_back(compileEffect(*effect, slot, analysis));
	}
	
	if (executors.size() == 1) {
		return executors[0];
	}
	
	return [executors](BindingExecutionEnv& env) {
		for (const auto& exec : executors) {
			exec(env);
		}
	};
}

static std::unordered_map<std::string, EffectExecutor> compileCustomEffects(
	const Binding& binding,
	BindingAnalysis& analysis)
{
	std::unordered_map<std::string, EffectExecutor> result;
	
	for (const auto& [key, effects] : binding.go.custom) {
		auto executor = compileEffectList(effects, key, analysis);
		if (executor.has_value()) {
			result[key] = executor.value();
		}
	}
	
	return result;
}

/* ============================================================================
 * Public compiler functions
 * ============================================================================ */

CompiledBinding compileBinding(const Binding& binding, const PatternParser& parse) {
	BindingAnalysis analysis;
	
	CompiledBinding compiled;
	compiled.name = binding.name;
	compiled.priority = binding.priority;
	compiled.predicate = compilePredicate(binding);
	
	// Compile patterns
	if (binding.on.press.has_value()) {
		compiled.press = parse(binding.on.press.value());
	}
	if (binding.on.hold.has_value()) {
		compiled.hold = parse(binding.on.hold.value());
	}
	if (binding.on.release.has_value()) {
		compiled.release = parse(binding.on.release.value());
	}
	
	// Compile custom edges
	auto customEffects = compileCustomEffects(binding, analysis);
	for (const auto& entry : binding.on.custom) {
		CompiledCustomEdge edge;
		edge.name = entry.name;
		edge.match = parse(entry.pattern);
		
		auto it = customEffects.find(entry.name);
		if (it != customEffects.end()) {
			edge.effect = it->second;
		}
		
		compiled.customEdges.push_back(std::move(edge));
	}
	
	// Compile effects
	auto pressEffect = compileEffectList(binding.go.press, "press", analysis);
	if (pressEffect.has_value()) compiled.pressEffect = pressEffect.value();
	
	auto holdEffect = compileEffectList(binding.go.hold, "hold", analysis);
	if (holdEffect.has_value()) compiled.holdEffect = holdEffect.value();
	
	auto releaseEffect = compileEffectList(binding.go.release, "release", analysis);
	if (releaseEffect.has_value()) compiled.releaseEffect = releaseEffect.value();
	
	compiled.usesEffectTriggers = analysis.usesEffectTriggers;
	
	return compiled;
}

CompiledProgram compileProgram(
	const InputActionEffectProgram& program,
	const PatternParser& parse)
{
	CompiledProgram compiled;
	compiled.evalMode = program.evalMode;
	compiled.priority = program.priority;
	
	// Compile all bindings
	struct IndexedBinding {
		size_t index;
		CompiledBinding binding;
	};
	
	std::vector<IndexedBinding> indexed;
	indexed.reserve(program.bindings.size());
	
	for (size_t i = 0; i < program.bindings.size(); i++) {
		indexed.push_back({i, compileBinding(program.bindings[i], parse)});
	}
	
	// Sort by priority (descending), then by index (ascending)
	std::sort(indexed.begin(), indexed.end(), [](const IndexedBinding& a, const IndexedBinding& b) {
		if (a.binding.priority != b.binding.priority) {
			return a.binding.priority > b.binding.priority;
		}
		return a.index < b.index;
	});
	
	// Extract compiled bindings
	compiled.bindings.reserve(indexed.size());
	for (auto& entry : indexed) {
		if (entry.binding.usesEffectTriggers) {
			compiled.usesEffectTriggers = true;
		}
		compiled.bindings.push_back(std::move(entry.binding));
	}
	
	return compiled;
}

/* ============================================================================
 * Validation
 * ============================================================================ */

static void validateEffect(
	const Effect& effect,
	const std::string& programId,
	const std::string& bindingName,
	const std::string& slot);

static void validateEffectSpec(
	const std::vector<std::shared_ptr<Effect>>& effects,
	const std::string& programId,
	const std::string& bindingName,
	const std::string& slot)
{
	for (size_t i = 0; i < effects.size(); i++) {
		std::string subSlot = slot + "[" + std::to_string(i) + "]";
		validateEffect(*effects[i], programId, bindingName, subSlot);
	}
}

static void validateEffect(
	const Effect& effect,
	const std::string& programId,
	const std::string& bindingName,
	const std::string& slot)
{
	std::visit([&](auto&& arg) {
		using T = std::decay_t<decltype(arg)>;
		
		if constexpr (std::is_same_v<T, EffectTrigger>) {
			std::visit([&](auto&& trigger) {
				using TT = std::decay_t<decltype(trigger)>;
				
				std::string effectId;
				std::any payload;
				
				if constexpr (std::is_same_v<TT, std::string>) {
					effectId = trigger;
				} else {
					effectId = trigger.id;
					payload = trigger.payload.value_or(std::any{});
				}
				
				// Validate against registry
				ActionEffectRegistry::instance().validate(effectId, payload);
			}, arg.trigger);
		}
		else if constexpr (std::is_same_v<T, NestedCommands>) {
			for (size_t i = 0; i < arg.commands.size(); i++) {
				std::string subSlot = slot + ".commands[" + std::to_string(i) + "]";
				validateEffect(*arg.commands[i], programId, bindingName, subSlot);
			}
		}
	}, effect.value);
}

void validateProgramEffects(
	const InputActionEffectProgram& program,
	const std::string& programId)
{
	for (size_t i = 0; i < program.bindings.size(); i++) {
		const Binding& binding = program.bindings[i];
		std::string bindingName = binding.name.value_or("#" + std::to_string(i));
		
		validateEffectSpec(binding.go.press, programId, bindingName, "press");
		validateEffectSpec(binding.go.hold, programId, bindingName, "hold");
		validateEffectSpec(binding.go.release, programId, bindingName, "release");
		
		for (const auto& [key, effects] : binding.go.custom) {
			validateEffectSpec(effects, programId, bindingName, "custom:" + key);
		}
	}
}

/* ============================================================================
 * DSL validation helper
 * ============================================================================ */

bool isInputActionEffectProgram(const std::any& value) {
	// Basic type check - in practice would need more sophisticated validation
	if (!value.has_value()) return false;
	
	try {
		std::any_cast<InputActionEffectProgram>(value);
		return true;
	} catch (const std::bad_any_cast&) {
		return false;
	}
}

} // namespace bmsx
