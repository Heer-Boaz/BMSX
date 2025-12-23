/*
 * timeline.h - Timeline system for BMSX
 *
 * Mirrors TypeScript timeline/timeline.ts
 *
 * A Timeline represents a sequence of frames that can be played, paused,
 * and manipulated. Used by the FSM for state-associated animations.
 */

#ifndef BMSX_TIMELINE_H
#define BMSX_TIMELINE_H

#include "../core/types.h"
#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <optional>
#include <memory>
#include <any>
#include <variant>
#include <limits>

namespace bmsx {

using Identifier = std::string;

/* ============================================================================
 * Constants
 * ============================================================================ */

constexpr i32 TIMELINE_START_INDEX = -1;

/* ============================================================================
 * Playback mode
 * ============================================================================ */

enum class TimelinePlaybackMode {
    Once,       // Play once and stop at end
    Loop,       // Loop back to start when reaching end
    PingPong    // Reverse direction at ends
};

/* ============================================================================
 * Timeline markers
 * ============================================================================ */

struct TimelineFrameMarkerAt {
    i32 frame;
};

struct TimelineUTMarkerAt {
    f32 u; // Normalized time (0-1)
};

using TimelineMarkerAt = std::variant<TimelineFrameMarkerAt, TimelineUTMarkerAt>;

struct TimelineMarker {
    TimelineMarkerAt at;
    std::string event;
    std::unordered_map<std::string, std::any> payload;
    std::vector<std::string> add_tags;
    std::vector<std::string> remove_tags;
};

struct TimelineWindow {
    std::string name;
    TimelineMarkerAt start;
    TimelineMarkerAt end;
    std::string tag;
    std::unordered_map<std::string, std::any> payloadstart;
    std::unordered_map<std::string, std::any> payloadend;
};

/* ============================================================================
 * Compiled markers
 * ============================================================================ */

struct CompiledTimelineMarker {
    i32 frame;
    std::string event;
    std::unordered_map<std::string, std::any> payload;
    std::vector<std::string> addtags;
    std::vector<std::string> removetags;
};

struct CompiledTimelineMarkerCache {
    std::unordered_map<i32, std::vector<CompiledTimelineMarker>> by_frame;
    std::vector<std::string> controlled_tags;
};

/* ============================================================================
 * Timeline definition
 * ============================================================================ */

template<typename T = std::any>
struct TimelineDefinition {
    std::string id;
    std::vector<T> frames;
    i32 ticks_per_frame = 0;
    TimelinePlaybackMode playback_mode = TimelinePlaybackMode::Once;
    std::string easing;
    i32 repetitions = 1;
    bool autotick = false;
    std::vector<TimelineMarker> markers;
    std::vector<TimelineWindow> windows;
};

/* ============================================================================
 * Timeline events
 * ============================================================================ */

enum class TimelineFrameChangeReason {
    Advance,
    Seek,
    Snap
};

template<typename T = std::any>
struct TimelineFrameEvent {
    i32 previous;
    i32 current;
    T value;
    bool rewound;
    TimelineFrameChangeReason reason;
    i32 direction; // 1 or -1
};

struct TimelineEndEvent {
    i32 frame;
    TimelinePlaybackMode mode;
    bool wrapped;
};

template<typename T = std::any>
struct TimelineEvent {
    bool is_frame_event;
    TimelineFrameEvent<T> frame_event;
    TimelineEndEvent end_event;
};

/* ============================================================================
 * Play options
 * ============================================================================ */

struct TimelinePlayOptions {
    std::optional<i32> start_frame;
    std::optional<TimelinePlaybackMode> mode;
    std::optional<bool> rewind;
    std::optional<bool> snap_to_start;
};

/* ============================================================================
 * StateTimelineConfig
 *
 * Configuration for timelines associated with a state definition.
 * ============================================================================ */

// Forward declaration
template<typename T> class Timeline;

struct StateTimelineConfig {
    std::optional<std::string> id;
    std::function<std::unique_ptr<Timeline<std::any>>()> create;
    bool autoplay = true;
    bool stop_on_exit = true;
    std::optional<TimelinePlayOptions> play_options;
};

/* ============================================================================
 * StateTimelineBinding
 *
 * Binds a timeline to a state for automatic activation/deactivation.
 * ============================================================================ */

struct StateTimelineBinding {
    Identifier id;
    std::function<std::unique_ptr<Timeline<std::any>>()> create;
    bool autoplay = true;
    bool stopOnExit = true;
    TimelinePlayOptions playOptions;
    bool defined = false;
};

using StateTimelineMap = std::unordered_map<std::string, StateTimelineConfig>;

/* ============================================================================
 * Easing functions
 * ============================================================================ */

using EasingFunction = std::function<f32(f32)>;

EasingFunction get_easing(const std::string& name);

/* ============================================================================
 * Timeline class
 * ============================================================================ */

template<typename T = std::any>
class Timeline {
public:
    // The definition this timeline was created from
    const TimelineDefinition<T> def;
    const std::string id;

private:
    std::vector<T> frames;
    i32 ticks_per_frame;
    TimelinePlaybackMode playback_mode;
    EasingFunction easing_fn;
    bool auto_tick;

    i32 _head = TIMELINE_START_INDEX;
    f32 _ticks = 0;
    f32 _tick_threshold = std::numeric_limits<f32>::infinity();
    i32 _direction = 1;

public:
    explicit Timeline(const TimelineDefinition<T>& definition);

    // Properties
    i32 length() const { return static_cast<i32>(frames.size()); }
    i32 head() const { return _head; }
    i32 direction() const { return _direction; }
    const T* value() const;

    // Playback control
    void rewind();
    std::vector<TimelineEvent<T>> tick(f32 dt);
    std::vector<TimelineEvent<T>> advance();
    std::vector<TimelineEvent<T>> seek(i32 frame);
    std::vector<TimelineEvent<T>> snap_to_start();
    void force_seek(i32 frame);

private:
    std::vector<TimelineEvent<T>> advanceInternal(TimelineFrameChangeReason reason);
    std::vector<TimelineEvent<T>> applyFrame(i32 target, TimelineFrameChangeReason reason);
    void updateTickThreshold();
    f32 computeProgress(i32 index) const;
};

/* ============================================================================
 * TimelineHost interface
 *
 * Objects that can host timelines implement this interface.
 * ============================================================================ */

class TimelineHost {
public:
    virtual ~TimelineHost() = default;

    // Define a timeline from a definition
    virtual void define_timeline(std::unique_ptr<Timeline<std::any>> timeline) = 0;

    // Playback control
    virtual void play_timeline(const Identifier& id, const TimelinePlayOptions* opts = nullptr) = 0;
    virtual void stop_timeline(const Identifier& id) = 0;

    // Get a timeline by id
    virtual Timeline<std::any>* get_timeline(const Identifier& id) = 0;
};

/* ============================================================================
 * Helper functions
 * ============================================================================ */

template<typename T>
std::vector<T> expand_timeline_frames(const std::vector<T>& frames, i32 repetitions);

i32 clamp_marker_frame(const TimelineMarkerAt& at, i32 length);

std::vector<TimelineMarker> expand_timeline_windows(
    const std::vector<TimelineMarker>& markers,
    const std::vector<TimelineWindow>& windows
);

template<typename T>
CompiledTimelineMarkerCache compile_timeline_markers(const TimelineDefinition<T>& def);

} // namespace bmsx

#endif // BMSX_TIMELINE_H
