import { ETInstant, ETRange, EventTimeline } from './eventtimeline';

export interface EventTimelineJSON {
    mode?: 'u' | 'time';
    instants?: ({ name: string; data?: any; } & ({ u: number } | { time: number }))[];
    ranges?: ETRange[];
}
export type EventTimelineRangeResolver = (rangeDef: any, timeline: EventTimeline) => ETRange['update'];
export interface LoadEventTimelineOptions { resolvers?: Record<string, EventTimelineRangeResolver>; autoAddUnhandledAsNoop?: boolean; }

export function loadEventTimelineFromJSON(json: EventTimelineJSON, opts: LoadEventTimelineOptions = {}): EventTimeline {
    const tl = new EventTimeline({ mode: json.mode || 'u' });
    const resolvers = opts.resolvers || {}; const autoNoop = opts.autoAddUnhandledAsNoop !== false;
    if (json.instants) {
        for (const inst of json.instants as ETInstant[]) {
            const ie: ETInstant = tl.mode === 'u' ? { u: inst.u, name: inst.name, data: inst.data } : { time: inst.time, name: inst.name, data: inst.data };
            tl.addInstant(ie);
        }
    }
    if (json.ranges) {
        for (const r of json.ranges as ETRange[]) {
            const type = r.type || 'noop';
            const resolver = resolvers[type];
            let updateFn: ETRange['update'];
            if (resolver) updateFn = resolver(r, tl); else if (autoNoop) updateFn = () => { }; else continue;
            const range: ETRange = tl.mode === 'u'
                ? { startU: r.startU, endU: r.endU, update: updateFn, type: type }
                : { startTime: r.startTime, endTime: r.endTime, update: updateFn, type: type };
            tl.addRange(range);
        }
    }
    return tl;
}
