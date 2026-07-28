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

SubscriptionHandle DefaultLifecycle::onFocusChange(std::function<void(bool)> handler) {
	return addSubscriptionHandler(m_focus_handlers, m_next_handler_id, std::move(handler));
}

SubscriptionHandle DefaultLifecycle::onWillExit(std::function<void()> handler) {
	return addSubscriptionHandler(m_exit_handlers, m_next_handler_id, std::move(handler));
}

void DefaultLifecycle::triggerFocusChange(bool focused) {
	for (const auto& entry : m_focus_handlers) {
		entry.handler(focused);
	}
}

void DefaultLifecycle::triggerExit() {
	for (const auto& entry : m_exit_handlers) {
		entry.handler();
	}
}

} // namespace bmsx
