/*
 * timeline.cpp - Timeline system implementation
 *
 * Mirrors TypeScript timeline/timeline.ts
 */

#include "timeline.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <set>

namespace bmsx {

/* ============================================================================
 * Easing functions
 * ============================================================================ */

static f32 easeLinear(f32 t) { return t; }
static f32 easeInQuad(f32 t) { return t * t; }
static f32 easeOutQuad(f32 t) { return t * (2 - t); }
static f32 easeInOutQuad(f32 t) { return t < 0.5f ? 2 * t * t : -1 + (4 - 2 * t) * t; }
static f32 easeInCubic(f32 t) { return t * t * t; }
static f32 easeOutCubic(f32 t) { f32 t1 = t - 1; return t1 * t1 * t1 + 1; }
static f32 easeInOutCubic(f32 t) { return t < 0.5f ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; }
static f32 easeInSine(f32 t) { return 1 - std::cos(t * 3.14159265f / 2); }
static f32 easeOutSine(f32 t) { return std::sin(t * 3.14159265f / 2); }
static f32 easeInOutSine(f32 t) { return -(std::cos(3.14159265f * t) - 1) / 2; }

EasingFunction get_easing(const std::string& name) {
    static const std::unordered_map<std::string, EasingFunction> easings = {
        {"linear", easeLinear},
        {"easeInQuad", easeInQuad},
        {"easeOutQuad", easeOutQuad},
        {"easeInOutQuad", easeInOutQuad},
        {"easeInCubic", easeInCubic},
        {"easeOutCubic", easeOutCubic},
        {"easeInOutCubic", easeInOutCubic},
        {"easeInSine", easeInSine},
        {"easeOutSine", easeOutSine},
        {"easeInOutSine", easeInOutSine},
    };

    auto it = easings.find(name);
    if (it != easings.end()) {
        return it->second;
    }
    return nullptr;
}

/* ============================================================================
 * Helper functions
 * ============================================================================ */

template<typename T>
std::vector<T> expand_timeline_frames(const std::vector<T>& frames, i32 repetitions) {
    if (frames.empty()) return {};
    if (repetitions <= 1) return frames;

    std::vector<T> out;
    out.reserve(frames.size() * repetitions);
    for (i32 i = 0; i < repetitions; ++i) {
        out.insert(out.end(), frames.begin(), frames.end());
    }
    return out;
}

// Explicit instantiation for std::any
template std::vector<std::any> expand_timeline_frames(const std::vector<std::any>& frames, i32 repetitions);

i32 clamp_marker_frame(const TimelineMarkerAt& at, i32 length) {
    if (std::holds_alternative<TimelineFrameMarkerAt>(at)) {
        i32 frame = std::get<TimelineFrameMarkerAt>(at).frame;
        return std::clamp(frame, 0, length - 1);
    }
    f32 normalized = std::clamp(std::get<TimelineUTMarkerAt>(at).u, 0.0f, 1.0f);
    return std::clamp(static_cast<i32>(normalized * (length - 1)), 0, length - 1);
}

std::vector<TimelineMarker> expand_timeline_windows(
    const std::vector<TimelineMarker>& markers,
    const std::vector<TimelineWindow>& windows
) {
    if (windows.empty()) return markers;

    std::vector<TimelineMarker> out = markers;
    for (const auto& windowDef : windows) {
        std::string tag = windowDef.tag.empty()
            ? "timeline.window." + windowDef.name
            : windowDef.tag;

        TimelineMarker startMarker;
        startMarker.at = windowDef.start;
        startMarker.event = "window." + windowDef.name + ".start";
        startMarker.payload = windowDef.payloadstart;
        startMarker.add_tags = {tag};

        TimelineMarker endMarker;
        endMarker.at = windowDef.end;
        endMarker.event = "window." + windowDef.name + ".end";
        endMarker.payload = windowDef.payloadend;
        endMarker.remove_tags = {tag};

        out.push_back(std::move(startMarker));
        out.push_back(std::move(endMarker));
    }
    return out;
}

template<typename T>
CompiledTimelineMarkerCache compile_timeline_markers(const TimelineDefinition<T>& def) {
    CompiledTimelineMarkerCache cache;

    auto frames = expand_timeline_frames(def.frames, def.repetitions);
    if (frames.empty()) return cache;

    auto expanded = expand_timeline_windows(def.markers, def.windows);
    std::set<std::string> controlled;

    for (const auto& marker : expanded) {
        i32 frame = clamp_marker_frame(marker.at, static_cast<i32>(frames.size()));

        CompiledTimelineMarker compiled;
        compiled.frame = frame;
        compiled.event = marker.event;
        compiled.payload = marker.payload;
        compiled.addtags = marker.add_tags;
        compiled.removetags = marker.remove_tags;

        cache.by_frame[frame].push_back(std::move(compiled));

        for (const auto& tag : marker.add_tags) controlled.insert(tag);
        for (const auto& tag : marker.remove_tags) controlled.insert(tag);
    }

    cache.controlled_tags.assign(controlled.begin(), controlled.end());
    return cache;
}

// Explicit instantiation
template CompiledTimelineMarkerCache compile_timeline_markers(const TimelineDefinition<std::any>& def);

/* ============================================================================
 * Timeline implementation
 * ============================================================================ */

template<typename T>
Timeline<T>::Timeline(const TimelineDefinition<T>& definition)
    : def(definition)
    , id(definition.id)
    , ticks_per_frame(definition.ticks_per_frame)
    , playback_mode(definition.playback_mode)
    , auto_tick(definition.autotick || definition.ticks_per_frame != 0)
{
    if (id.empty()) {
        throw std::runtime_error("[Timeline] Timeline requires a non-empty id.");
    }

    frames = expand_timeline_frames(definition.frames, definition.repetitions);

    if (!definition.easing.empty()) {
        easing_fn = get_easing(definition.easing);
    }

    updateTickThreshold();
}

template<typename T>
const T* Timeline<T>::value() const {
    if (_head < 0 || _head >= static_cast<i32>(frames.size())) {
        return nullptr;
    }
    return &frames[_head];
}

template<typename T>
void Timeline<T>::rewind() {
    _head = TIMELINE_START_INDEX;
    _ticks = 0;
    _direction = 1;
    updateTickThreshold();
}

template<typename T>
std::vector<TimelineEvent<T>> Timeline<T>::tick(f32 dt) {
    if (!auto_tick || frames.empty()) return {};

    _ticks += dt;
    if (ticks_per_frame <= 0 || _ticks >= _tick_threshold) {
        return advanceInternal(TimelineFrameChangeReason::Advance);
    }
    return {};
}

template<typename T>
std::vector<TimelineEvent<T>> Timeline<T>::advance() {
    return advanceInternal(TimelineFrameChangeReason::Advance);
}

template<typename T>
std::vector<TimelineEvent<T>> Timeline<T>::seek(i32 frame) {
    return applyFrame(frame, TimelineFrameChangeReason::Seek);
}

template<typename T>
std::vector<TimelineEvent<T>> Timeline<T>::snap_to_start() {
    return applyFrame(0, TimelineFrameChangeReason::Snap);
}

template<typename T>
void Timeline<T>::force_seek(i32 frame) {
    if (frames.empty()) {
        _head = TIMELINE_START_INDEX;
        _ticks = 0;
        _direction = 1;
        updateTickThreshold();
        return;
    }

    i32 clamped = std::clamp(frame, TIMELINE_START_INDEX, static_cast<i32>(frames.size()) - 1);
    _head = clamped;
    _ticks = 0;

    if (playback_mode != TimelinePlaybackMode::PingPong) {
        _direction = 1;
    } else if (clamped <= 0) {
        _direction = 1;
    }
    updateTickThreshold();
}

template<typename T>
std::vector<TimelineEvent<T>> Timeline<T>::advanceInternal(TimelineFrameChangeReason reason) {
    if (frames.empty()) return {};

    i32 delta = (playback_mode == TimelinePlaybackMode::PingPong) ? _direction : 1;
    i32 target = _head + ((_head == TIMELINE_START_INDEX) ? 1 : delta);
    return applyFrame(target, reason);
}

template<typename T>
std::vector<TimelineEvent<T>> Timeline<T>::applyFrame(i32 target, TimelineFrameChangeReason reason) {
    std::vector<TimelineEvent<T>> events;
    if (frames.empty()) return events;

    i32 lastIndex = static_cast<i32>(frames.size()) - 1;
    i32 previous = _head;
    i32 next = target;
    bool rewound = false;
    bool emitFrame = true;
    bool emitEnd = false;
    bool wrapped = false;

    if (reason == TimelineFrameChangeReason::Seek) {
        _direction = 1;
    }

    if (next < 0) {
        next = 0;
        _direction = 1;
        emitEnd = true;
    } else if (next > lastIndex) {
        if (playback_mode == TimelinePlaybackMode::Loop) {
            next = 0;
            rewound = true;
            emitEnd = true;
            wrapped = true;
            _direction = 1;
        } else if (playback_mode == TimelinePlaybackMode::PingPong) {
            next = lastIndex;
            if (lastIndex > 0) _direction = -1;
            if (previous == next) emitFrame = false;
            emitEnd = true;
        } else {
            // Once mode
            next = lastIndex;
            if (previous == next) emitFrame = false;
            emitEnd = true;
            _direction = 1;
        }
    }

    if (previous == next && !rewound && !emitEnd && reason == TimelineFrameChangeReason::Advance) {
        return events;
    }

    _head = next;
    _ticks = 0;
    updateTickThreshold();

    if (emitFrame) {
        TimelineEvent<T> event;
        event.is_frame_event = true;
        event.frame_event.previous = previous;
        event.frame_event.current = next;
        event.frame_event.value = frames[next];
        event.frame_event.rewound = rewound;
        event.frame_event.direction = _direction;
        event.frame_event.reason = reason;
        events.push_back(std::move(event));
    }

    if (emitEnd) {
        TimelineEvent<T> event;
        event.is_frame_event = false;
        event.end_event.frame = _head;
        event.end_event.mode = playback_mode;
        event.end_event.wrapped = wrapped;
        events.push_back(std::move(event));
    }

    return events;
}

template<typename T>
void Timeline<T>::updateTickThreshold() {
    if (!easing_fn) {
        _tick_threshold = static_cast<f32>(ticks_per_frame);
        return;
    }
    if (ticks_per_frame <= 0 || frames.empty()) {
        _tick_threshold = static_cast<f32>(ticks_per_frame);
        return;
    }

    f32 before = computeProgress(_head);
    f32 after = computeProgress(_head + _direction);

    if (after == before) {
        _tick_threshold = std::numeric_limits<f32>::infinity();
        return;
    }

    f32 easedBefore = easing_fn(before);
    f32 easedAfter = easing_fn(after);
    f32 delta = std::abs(easedAfter - easedBefore);

    f32 scaled = ticks_per_frame * (delta > 0 ? delta * frames.size() : 1);
    _tick_threshold = std::max(scaled, std::numeric_limits<f32>::epsilon());
}

template<typename T>
f32 Timeline<T>::computeProgress(i32 index) const {
    if (frames.empty()) return 0;
    i32 len = static_cast<i32>(frames.size());
    i32 clamped = std::clamp(index, TIMELINE_START_INDEX, len);
    if (clamped <= TIMELINE_START_INDEX) return 0;
    if (clamped >= len) return 1;
    return static_cast<f32>(clamped + 1) / len;
}

// Explicit instantiation for std::any (the default template type)
template class Timeline<std::any>;

} // namespace bmsx
