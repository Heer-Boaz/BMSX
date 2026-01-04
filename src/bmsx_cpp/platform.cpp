/*
 * platform.cpp - Platform abstraction implementation
 */

#include "platform.h"

namespace bmsx {

/* ============================================================================
 * DefaultMicrotaskQueue implementation
 * ============================================================================ */

void DefaultMicrotaskQueue::queueMicrotask(std::function<void()> task) {
	m_queue.push_back(std::move(task));
}

void DefaultMicrotaskQueue::flush() {
	// Process all pending tasks (may add more during execution)
	while (!m_queue.empty()) {
		auto tasks = std::move(m_queue);
		m_queue.clear();
		for (auto& task : tasks) {
			task();
		}
	}
}

/* ============================================================================
 * DefaultLifecycle implementation
 * ============================================================================ */

DefaultLifecycle::DefaultLifecycle() = default;
DefaultLifecycle::~DefaultLifecycle() = default;

SubscriptionHandle DefaultLifecycle::onWillExit(std::function<void()> handler) {
	m_handlers.push_back(handler);
	size_t idx = m_handlers.size() - 1;

	return SubscriptionHandle::create([this, idx]() {
		if (idx < m_handlers.size()) {
			m_handlers.erase(m_handlers.begin() + static_cast<ptrdiff_t>(idx));
		}
	});
}

void DefaultLifecycle::triggerExit() {
	for (const auto& handler : m_handlers) {
		handler();
	}
}

} // namespace bmsx