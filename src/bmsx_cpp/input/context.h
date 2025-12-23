/*
 * context.h - Input mapping context stack for BMSX
 *
 * Provides layered input mappings with priority-based resolution.
 * Mirrors TypeScript input/context.ts
 */

#ifndef BMSX_INPUT_CONTEXT_H
#define BMSX_INPUT_CONTEXT_H

#include "inputtypes.h"
#include <algorithm>
#include <set>

namespace bmsx {

/* ============================================================================
 * MappingContext
 *
 * A single layer of input mappings with a priority level.
 * ============================================================================ */

struct MappingContext {
	std::string id;
	i32 priority = 0;
	bool enabled = true;
	
	KeyboardInputMapping keyboard;
	GamepadInputMapping gamepad;
	PointerInputMapping pointer;
	
	MappingContext() = default;
	MappingContext(const std::string& id_, i32 priority_, bool enabled_ = true)
		: id(id_), priority(priority_), enabled(enabled_) {}
};

/* ============================================================================
 * ContextStack
 *
 * Stack of mapping contexts, merged by ascending priority.
 * ============================================================================ */

class ContextStack {
public:
	// Push a new context onto the stack
	void push(const MappingContext& ctx) {
		m_contexts.push_back(ctx);
	}
	
	// Pop a context by ID (or most recent if no ID)
	std::optional<MappingContext> pop(const std::string& id = "") {
		if (id.empty()) {
			if (m_contexts.empty()) return std::nullopt;
			auto ctx = std::move(m_contexts.back());
			m_contexts.pop_back();
			return ctx;
		}
		
		auto it = std::find_if(m_contexts.begin(), m_contexts.end(),
			[&id](const MappingContext& c) { return c.id == id; });
		
		if (it == m_contexts.end()) return std::nullopt;
		
		auto ctx = std::move(*it);
		m_contexts.erase(it);
		return ctx;
	}
	
	// Enable/disable a context by ID
	void enable(const std::string& id, bool enabled) {
		for (auto& ctx : m_contexts) {
			if (ctx.id == id) {
				ctx.enabled = enabled;
				return;
			}
		}
	}
	
	// Set priority of a context by ID
	void setPriority(const std::string& id, i32 priority) {
		for (auto& ctx : m_contexts) {
			if (ctx.id == id) {
				ctx.priority = priority;
				return;
			}
		}
	}
	
	// Get merged keyboard bindings for an action
	std::vector<KeyboardBinding> getKeyboardBindings(const std::string& action) const {
		return getBindings<KeyboardBinding>(action, &MappingContext::keyboard);
	}
	
	// Get merged gamepad bindings for an action
	std::vector<GamepadBinding> getGamepadBindings(const std::string& action) const {
		return getBindings<GamepadBinding>(action, &MappingContext::gamepad);
	}
	
	// Get merged pointer bindings for an action
	std::vector<PointerBinding> getPointerBindings(const std::string& action) const {
		return getBindings<PointerBinding>(action, &MappingContext::pointer);
	}
	
	// Check if stack is empty
	bool empty() const { return m_contexts.empty(); }
	
	// Get context count
	size_t size() const { return m_contexts.size(); }
	
	// Clear all contexts
	void clear() { m_contexts.clear(); }
	
private:
	std::vector<MappingContext> m_contexts;
	
	// Get active contexts sorted by priority (ascending)
	std::vector<const MappingContext*> getActiveContexts() const {
		std::vector<const MappingContext*> active;
		for (const auto& ctx : m_contexts) {
			if (ctx.enabled) {
				active.push_back(&ctx);
			}
		}
		std::sort(active.begin(), active.end(),
			[](const MappingContext* a, const MappingContext* b) {
				return a->priority < b->priority;
			});
		return active;
	}
	
	// Generic binding retrieval with deduplication
	template<typename BindingType, typename MappingType>
	std::vector<BindingType> getBindings(
		const std::string& action,
		MappingType MappingContext::*mapping) const 
	{
		std::vector<BindingType> out;
		std::set<std::string> seen;
		
		for (const auto* ctx : getActiveContexts()) {
			const auto& map = ctx->*mapping;
			auto it = map.find(action);
			if (it == map.end()) continue;
			
			for (const auto& binding : it->second) {
				if (seen.find(binding.id) == seen.end()) {
					out.push_back(binding);
					seen.insert(binding.id);
				}
			}
		}
		
		return out;
	}
};

} // namespace bmsx

#endif // BMSX_INPUT_CONTEXT_H
