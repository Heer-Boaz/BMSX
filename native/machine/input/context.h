/*
 * context.h - Input mapping context stack for BMSX
 *
 * Provides layered input mappings with priority-based resolution.
 */

#ifndef BMSX_INPUT_CONTEXT_H
#define BMSX_INPUT_CONTEXT_H

#include "models.h"
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

	std::vector<InputBinding> getBindings(const std::string& action, InputSource device) const {
		std::vector<InputBinding> out;
		std::set<std::string> seen;
		forEachEnabledContextByPriority([&](const MappingContext& ctx) {
			switch (device) {
				case InputSource::Keyboard: {
					auto it = ctx.keyboard.find(action);
					if (it == ctx.keyboard.end()) {
						break;
					}
					for (const auto& binding : it->second) {
						if (seen.find(binding.id) == seen.end()) {
							out.emplace_back(binding);
							seen.insert(binding.id);
						}
					}
					break;
				}
				case InputSource::Gamepad: {
					auto it = ctx.gamepad.find(action);
					if (it == ctx.gamepad.end()) {
						break;
					}
					for (const auto& binding : it->second) {
						if (seen.find(binding.id) == seen.end()) {
							out.emplace_back(binding);
							seen.insert(binding.id);
						}
					}
					break;
				}
				case InputSource::Pointer: {
					auto it = ctx.pointer.find(action);
					if (it == ctx.pointer.end()) {
						break;
					}
					for (const auto& binding : it->second) {
						if (seen.find(binding.id) == seen.end()) {
							out.emplace_back(binding);
							seen.insert(binding.id);
						}
					}
					break;
				}
			}
		});
		return out;
	}

	template<typename Fn>
	void forEachAction(InputSource device, Fn&& visit) const {
		std::set<std::string> seen;
		forEachEnabledContextByPriority([&](const MappingContext& ctx) {
			switch (device) {
				case InputSource::Keyboard:
					visitMappedActions(ctx.keyboard, seen, visit);
					break;
				case InputSource::Gamepad:
					visitMappedActions(ctx.gamepad, seen, visit);
					break;
				case InputSource::Pointer:
					visitMappedActions(ctx.pointer, seen, visit);
					break;
			}
		});
	}

private:
	template<typename Fn>
	void forEachEnabledContextByPriority(Fn&& visit) const {
		bool haveLast = false;
		i32 lastPriority = 0;
		std::size_t lastIndex = 0;
		while (true) {
			const MappingContext* next = nullptr;
			std::size_t nextIndex = 0;
			for (std::size_t index = 0; index < m_contexts.size(); ++index) {
				const auto& ctx = m_contexts[index];
				if (!ctx.enabled) {
					continue;
				}
				if (haveLast && (ctx.priority < lastPriority || (ctx.priority == lastPriority && index <= lastIndex))) {
					continue;
				}
				if (!next || ctx.priority < next->priority || (ctx.priority == next->priority && index < nextIndex)) {
					next = &ctx;
					nextIndex = index;
				}
			}
			if (!next) {
				return;
			}
			visit(*next);
			lastPriority = next->priority;
			lastIndex = nextIndex;
			haveLast = true;
		}
	}

	template<typename Mapping, typename Fn>
	void visitMappedActions(const Mapping& mapping, std::set<std::string>& seen, Fn& visit) const {
		for (const auto& [action, bindings] : mapping) {
			(void)bindings;
			const auto inserted = seen.insert(action);
			if (inserted.second) {
				visit(action);
			}
		}
	}

	std::vector<MappingContext> m_contexts;
};

} // namespace bmsx

#endif // BMSX_INPUT_CONTEXT_H
