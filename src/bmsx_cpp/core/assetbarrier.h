#pragma once

#include "taskgate.h"
#include "primitives.h"
#include <chrono>
#include <functional>
#include <optional>
#include <string>
#include <unordered_map>
#include <iostream>

namespace bmsx {

template <typename T>
using BarrierDisposer = std::function<void(const T&)>;

template <typename T>
struct BarrierAcquireOptions {
	std::optional<T> fallback;
	bool block_render = false;
	std::string category = "other";
	std::string tag;
	BarrierDisposer<T> disposer;
	int warnIfLongerMs = 0;
};

template <typename T>
class AssetBarrier {
public:
	explicit AssetBarrier(GateGroup group) : group_(std::move(group)) {}

	T acquire(const std::string& key, const std::function<T()>& loader,
				const BarrierAcquireOptions<T>& opts = {}) {
		Entry& entry = ensureEntry(key, opts);
		if (entry.value.has_value()) {
			if (!opts.tag.empty() && entry.tag.empty()) entry.tag = opts.tag;
			if (opts.block_render) entry.blocking = true;
			if (!opts.category.empty() && entry.category != opts.category) entry.category = opts.category;
			return *entry.value;
		}

		GateScope scope;
		scope.blocking = entry.blocking;
		scope.category = entry.category;
		scope.tag = !opts.tag.empty() ? opts.tag : entry.tag;
		const auto start = std::chrono::steady_clock::now();
		GateToken token = group_.begin(scope);
		T value;
		try {
			value = loader();
		} catch (...) {
			group_.end(token);
			throw;
		}
		group_.end(token);
		const auto end = std::chrono::steady_clock::now();
		if (opts.warnIfLongerMs > 0) {
			const auto elapsed_ms =
				std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();
			if (elapsed_ms > opts.warnIfLongerMs) {
				std::cerr << "[AssetBarrier] Slow load > " << opts.warnIfLongerMs
							<< "ms for key=\"" << key << "\"" << std::endl;
			}
		}

		entry.value = value;
		entry.isFallback = false;
		return value;
	}

	T get(const std::string& key) const {
		auto it = map_.find(key);
		if (it == map_.end() || !it->second.value.has_value()) {
			return T{};
		}
		return *it->second.value;
	}

	void addRef(const std::string& key) {
		auto it = map_.find(key);
		if (it == map_.end()) {
			throw BMSX_RUNTIME_ERROR("[AssetBarrier] addRef called for unknown key \"" + key + "\".");
		}
		it->second.refCount++;
	}

	void release(const std::string& key, BarrierDisposer<T> disposer = {}) {
		auto it = map_.find(key);
		if (it == map_.end()) {
			throw BMSX_RUNTIME_ERROR("[AssetBarrier] release called for unknown key \"" + key + "\".");
		}
		Entry& entry = it->second;
		entry.refCount--;
		if (entry.refCount < 0) {
			throw BMSX_RUNTIME_ERROR("[AssetBarrier] refCount underflow for key \"" + key + "\".");
		}
		if (entry.refCount <= 0) {
			entry.gen++;
			if (entry.value.has_value() && !entry.isFallback) {
				auto callDisposer = disposer ? disposer : entry.disposer;
				if (callDisposer) {
					try { callDisposer(*entry.value); }
					catch (const std::exception& e) {
						std::cerr << "[AssetBarrier] disposer threw on release: " << e.what() << std::endl;
					}
				}
			}
			map_.erase(it);
		}
	}

	void invalidate(const std::string& key, BarrierDisposer<T> disposer = {}) {
		auto it = map_.find(key);
		if (it == map_.end()) {
			throw BMSX_RUNTIME_ERROR("[AssetBarrier] invalidate called for unknown key \"" + key + "\".");
		}
		Entry& entry = it->second;
		entry.gen++;
		if (entry.value.has_value() && !entry.isFallback) {
			auto callDisposer = disposer ? disposer : entry.disposer;
			if (callDisposer) {
				try { callDisposer(*entry.value); }
				catch (const std::exception& e) {
					std::cerr << "[AssetBarrier] disposer threw on invalidate: " << e.what() << std::endl;
				}
			}
		}
		entry.value.reset();
		entry.isFallback = false;
	}

	void clear(BarrierDisposer<T> disposer = {}) {
		for (auto& [key, entry] : map_) {
			entry.gen++;
			if (entry.value.has_value() && !entry.isFallback) {
				auto callDisposer = disposer ? disposer : entry.disposer;
				if (callDisposer) {
					try { callDisposer(*entry.value); }
					catch (const std::exception& e) {
						std::cerr << "[AssetBarrier] disposer threw on clear for key=\"" << key << "\": "
									<< e.what() << std::endl;
					}
				}
			}
		}
		map_.clear();
	}

	void replaceValue(const std::string& key, const T& value, BarrierDisposer<T> disposer = {}) {
		auto it = map_.find(key);
		if (it == map_.end()) {
			throw BMSX_RUNTIME_ERROR("[AssetBarrier] replaceValue called for unknown key \"" + key + "\".");
		}
		Entry& entry = it->second;
		const bool oldWasFallback = entry.isFallback;
		const std::optional<T> oldValue = entry.value;
		entry.value = value;
		entry.isFallback = false;
		if (oldValue.has_value() && !oldWasFallback) {
			auto callDisposer = disposer ? disposer : entry.disposer;
			if (callDisposer) {
				try { callDisposer(*oldValue); }
				catch (const std::exception& e) {
					std::cerr << "[AssetBarrier] disposer threw on replaceValue: " << e.what() << std::endl;
				}
			}
		}
	}

	struct SnapshotEntry {
		int ref = 0;
		bool hasValue = false;
		int gen = 0;
		bool blocking = false;
		std::string category;
		std::string tag;
	};

	std::unordered_map<std::string, SnapshotEntry> snapshot() const {
		std::unordered_map<std::string, SnapshotEntry> out;
		out.reserve(map_.size());
		for (const auto& [key, entry] : map_) {
			out[key] = {
				entry.refCount,
				entry.value.has_value(),
				entry.gen,
				entry.blocking,
				entry.category,
				entry.tag
			};
		}
		return out;
	}

private:
	struct Entry {
		int refCount = 0;
		std::optional<T> value;
		int gen = 0;
		bool blocking = false;
		std::string category = "other";
		std::string tag;
		BarrierDisposer<T> disposer;
		bool isFallback = false;
	};

	Entry& ensureEntry(const std::string& key, const BarrierAcquireOptions<T>& opts) {
		auto it = map_.find(key);
		if (it == map_.end()) {
			Entry entry;
			entry.refCount = 1;
			entry.value = opts.fallback;
			entry.isFallback = opts.fallback.has_value();
			entry.gen = 1;
			entry.blocking = opts.block_render;
			entry.category = opts.category.empty() ? "other" : opts.category;
			entry.tag = opts.tag;
			entry.disposer = opts.disposer;
			auto inserted = map_.emplace(key, std::move(entry));
			return inserted.first->second;
		}

		Entry& entry = it->second;
		entry.refCount++;
		if (opts.fallback.has_value() && !entry.value.has_value()) {
			entry.value = opts.fallback;
			entry.isFallback = true;
		}
		if (!opts.tag.empty() && entry.tag.empty()) entry.tag = opts.tag;
		if (opts.block_render) entry.blocking = true;
		if (opts.disposer && !entry.disposer) entry.disposer = opts.disposer;
		if (!opts.category.empty() && entry.category != opts.category) entry.category = opts.category;
		return entry;
	}

	GateGroup group_;
	std::unordered_map<std::string, Entry> map_;
};

} // namespace bmsx
