/**
 * BMSX C++ Console - Subscription Handle Implementation
 *
 * Provides the SubscriptionHandle pattern used throughout the platform layer.
 * This replaces JavaScript's closure-based unsubscribe pattern with an object
 * that can be managed without heap-allocated closures.
 */

#include "common/subscription.h"
#include <atomic>

namespace bmsx {

namespace {
	std::atomic<uint32_t> g_nextSubscriptionId{1};
}

SubscriptionHandle SubscriptionHandle::create(std::function<void()> cleanup) {
	SubscriptionHandle handle;
	handle.id = g_nextSubscriptionId.fetch_add(1, std::memory_order_relaxed);
	handle.active = true;
	handle.cleanup_ = std::move(cleanup);
	return handle;
}

void SubscriptionHandle::unsubscribe() {
	if (!active) return;
	active = false;
	if (cleanup_) {
		cleanup_();
		cleanup_ = nullptr;
	}
}

} // namespace bmsx
