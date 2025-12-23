/*
 * timelinecomponent.h - Timeline component for WorldObjects
 *
 * Mirrors TypeScript TimelineComponent behavior used by FSM timelines.
 */

#ifndef BMSX_TIMELINECOMPONENT_H
#define BMSX_TIMELINECOMPONENT_H

#include "component.h"
#include "../timeline/timeline.h"
#include "../fsm/fsmtypes.h"
#include <unordered_map>
#include <unordered_set>

namespace bmsx {

class TimelineComponent : public Component, public TimelineHost {
public:
	static const char* typeName() { return "TimelineComponent"; }

	explicit TimelineComponent(const ComponentAttachOptions& opts);

	void define_timeline(std::unique_ptr<Timeline<std::any>> timeline) override;
	void play_timeline(const Identifier& id, const TimelinePlayOptions* opts = nullptr) override;
	void stop_timeline(const Identifier& id) override;
	Timeline<std::any>* get_timeline(const Identifier& id) override;

	void tick_active(f64 dt);

private:
	struct RegisteredTimeline {
		std::unique_ptr<Timeline<std::any>> instance;
		CompiledTimelineMarkerCache compiled;
	};

	std::unordered_map<Identifier, RegisteredTimeline> m_registry;
	std::unordered_set<Identifier> m_active;

	void processEvents(RegisteredTimeline& entry, const std::vector<TimelineEvent<std::any>>& events);
	void emitFrameEvent(RegisteredTimeline& entry, const TimelineFrameEvent<std::any>& evt);
	void emitEndEvent(RegisteredTimeline& entry, const TimelineEndEvent& evt);
	void applyMarkers(RegisteredTimeline& entry, const TimelineFrameEvent<std::any>& evt);
	void dispatchTimelineEvent(const std::string& type, const Identifier& timelineId,
	                           const std::unordered_map<std::string, std::any>& payload);
};

} // namespace bmsx

#endif // BMSX_TIMELINECOMPONENT_H
