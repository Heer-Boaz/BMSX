/*
 * timelinecomponent.cpp - Timeline component implementation
 */

#include "timelinecomponent.h"
#include "../core/world.h"
#include "../fsm/fsmcontroller.h"
#include <utility>

namespace bmsx {

TimelineComponent::TimelineComponent(const ComponentAttachOptions& opts)
	: Component(opts)
{
}

void TimelineComponent::define_timeline(std::unique_ptr<Timeline<std::any>> timeline) {
	const Identifier id = timeline->id;
	RegisteredTimeline entry;
	entry.instance = std::move(timeline);
	entry.compiled = compile_timeline_markers(entry.instance->def);
	m_registry[id] = std::move(entry);
}

void TimelineComponent::play_timeline(const Identifier& id, const TimelinePlayOptions* opts) {
	auto it = m_registry.find(id);
	if (it == m_registry.end()) {
		throw std::runtime_error("[TimelineComponent] Unknown timeline '" + id + "'.");
	}

	auto& entry = it->second;
	bool rewind = opts ? opts->rewind.value_or(true) : true;
	bool snap = opts ? opts->snap_to_start.value_or(true) : true;
	if (rewind) {
		entry.instance->rewind();
	}
	if (snap) {
		auto events = entry.instance->snap_to_start();
		processEvents(entry, events);
	}
	m_active.insert(id);
}

void TimelineComponent::stop_timeline(const Identifier& id) {
	m_active.erase(id);
}

Timeline<std::any>* TimelineComponent::get_timeline(const Identifier& id) {
	auto it = m_registry.find(id);
	if (it == m_registry.end()) {
		return nullptr;
	}
	return it->second.instance.get();
}

void TimelineComponent::tick_active(f64 dt) {
	for (const auto& id : m_active) {
		auto it = m_registry.find(id);
		if (it == m_registry.end()) {
			continue;
		}
		auto& entry = it->second;
		auto events = entry.instance->tick(static_cast<f32>(dt));
		processEvents(entry, events);
	}
}

void TimelineComponent::processEvents(RegisteredTimeline& entry, const std::vector<TimelineEvent<std::any>>& events) {
	for (const auto& evt : events) {
		if (evt.is_frame_event) {
			applyMarkers(entry, evt.frame_event);
			emitFrameEvent(entry, evt.frame_event);
		} else {
			emitEndEvent(entry, evt.end_event);
			if (evt.end_event.mode == TimelinePlaybackMode::Once) {
				m_active.erase(entry.instance->id);
			}
		}
	}
}

void TimelineComponent::emitFrameEvent(RegisteredTimeline& entry, const TimelineFrameEvent<std::any>& evt) {
	std::unordered_map<std::string, std::any> payload;
	payload["timeline_id"] = entry.instance->id;
	payload["frame_index"] = static_cast<double>(evt.current);
	payload["frame_value"] = evt.value;
	payload["rewound"] = evt.rewound;
	payload["direction"] = static_cast<double>(evt.direction);
	dispatchTimelineEvent("timeline.frame", entry.instance->id, payload);
}

void TimelineComponent::emitEndEvent(RegisteredTimeline& entry, const TimelineEndEvent& evt) {
	std::unordered_map<std::string, std::any> payload;
	payload["timeline_id"] = entry.instance->id;
	payload["frame_index"] = static_cast<double>(evt.frame);
	dispatchTimelineEvent("timeline.end", entry.instance->id, payload);
}

void TimelineComponent::applyMarkers(RegisteredTimeline& entry, const TimelineFrameEvent<std::any>& evt) {
	const auto& compiled = entry.compiled;
	auto it = compiled.by_frame.find(evt.current);
	if (it == compiled.by_frame.end()) {
		return;
	}
	for (const auto& marker : it->second) {
		std::unordered_map<std::string, std::any> payload = marker.payload;
		dispatchTimelineEvent(marker.event, entry.instance->id, payload);
	}
}

void TimelineComponent::dispatchTimelineEvent(const std::string& type, const Identifier& timelineId,
                                              const std::unordered_map<std::string, std::any>& payload) {
	auto* owner = m_parent;
	auto* controller = owner->stateController();

	GameEvent baseEvent;
	baseEvent.type = type;
	baseEvent.emitter = owner->id;
	baseEvent.payload = payload;
	controller->dispatch(baseEvent);

	GameEvent scopedEvent = baseEvent;
	scopedEvent.type = type + "." + timelineId;
	controller->dispatch(scopedEvent);
}

} // namespace bmsx
