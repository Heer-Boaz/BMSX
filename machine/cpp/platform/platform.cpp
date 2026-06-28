/*
 * platform.cpp - Platform abstraction implementation
 */

#include "platform/platform.h"

namespace bmsx {

/* ============================================================================
 * DefaultMicrotaskQueue implementation
 * ============================================================================ */

void DefaultMicrotaskQueue::queueMicrotask(std::function<void()> task) {
	m_tasks.push_back(std::move(task));
}

void DefaultMicrotaskQueue::flush() {
	while (!m_tasks.empty()) {
		m_tasks.swap(m_drainTasks);
		try {
			for (auto& task : m_drainTasks) {
				task();
			}
		} catch (...) {
			m_drainTasks.clear();
			throw;
		}
		m_drainTasks.clear();
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
