/**
 * BMSX C++ Engine - Subscription Handle Header
 */

#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <utility>
#include <vector>

namespace bmsx {

/**
 * Handle returned by subscription-based APIs.
 * Unlike closure-based unsubscribe patterns, this object model avoids
 * frequent heap allocation for simple unsubscribe operations.
 */
struct SubscriptionHandle {
	uint32_t id = 0;
	bool active = false;

	void unsubscribe();

	// Factory for creating handles
	static SubscriptionHandle create(std::function<void()> cleanup);

	// Check if still subscribed
	explicit operator bool() const { return active; }

private:
	std::function<void()> cleanup_;
};

template <typename Handler>
struct SubscriptionEntry {
	uint32_t id;
	Handler handler;
};

template <typename Handler>
SubscriptionHandle addSubscriptionHandler(
		std::vector<SubscriptionEntry<Handler>>& handlers,
		uint32_t& nextId,
		Handler handler) {
	const uint32_t id = nextId++;
	handlers.push_back({ id, std::move(handler) });
	return SubscriptionHandle::create([&handlers, id]() {
		const auto it = std::find_if(handlers.begin(), handlers.end(), [id](const auto& entry) {
			return entry.id == id;
		});
		if (it != handlers.end()) {
			handlers.erase(it);
		}
	});
}

/**
 * RAII wrapper for automatic unsubscription.
 * Similar to std::unique_ptr but for subscriptions.
 */
class ScopedSubscription {
public:
	ScopedSubscription() = default;
	explicit ScopedSubscription(SubscriptionHandle handle) : handle_(handle) {}

	~ScopedSubscription() {
		if (handle_.active) {
			handle_.unsubscribe();
		}
	}

	// Move-only
	ScopedSubscription(ScopedSubscription&& other) noexcept
		: handle_(other.handle_) {
		other.handle_.active = false;
	}

	ScopedSubscription& operator=(ScopedSubscription&& other) noexcept {
		if (this != &other) {
			if (handle_.active) {
				handle_.unsubscribe();
			}
			handle_ = other.handle_;
			other.handle_.active = false;
		}
		return *this;
	}

	ScopedSubscription(const ScopedSubscription&) = delete;
	ScopedSubscription& operator=(const ScopedSubscription&) = delete;

	void release() {
		handle_.active = false;
	}

	SubscriptionHandle& get() { return handle_; }
	const SubscriptionHandle& get() const { return handle_; }

private:
	SubscriptionHandle handle_;
};

} // namespace bmsx
