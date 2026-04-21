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
	return addSubscriptionHandler(m_handlers, m_next_handler_id, std::move(handler));
}

void DefaultLifecycle::triggerExit() {
	for (const auto& entry : m_handlers) {
		entry.handler();
	}
}

} // namespace bmsx
