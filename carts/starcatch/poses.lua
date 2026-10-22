-- Shared scalar timeline definitions. Positions are pixels; spin is radians.
local timeline_clock<const> = require('cartlib/timeline/clock_source')
local poses<const> = {
    collector_idle = {
        duration_ms = 1200,
        clock_source = timeline_clock.frame,
        playback_mode = 'loop',
        tracks = {{
            kind = 'value',
            path = { 'bob' },
            interpolation = 'linear',
            keys = {
                { time_ms = 0, value = 0 },
                { time_ms = 600, value = 2 },
                { time_ms = 1200, value = 0 },
            },
        }},
    },
    collector_catch = {
        duration_ms = 240,
        clock_source = timeline_clock.frame,
        tracks = {{
            kind = 'value',
            path = { 'opening' },
            interpolation = 'linear',
            keys = {
                { time_ms = 0, value = 0 },
                { time_ms = 70, value = 1 },
                { time_ms = 240, value = 0 },
            },
        }},
    },
    collector_hurt = {
        duration_ms = 300,
        clock_source = timeline_clock.frame,
        tracks = {{
            kind = 'value',
            path = { 'recoil' },
            interpolation = 'linear',
            keys = {
                { time_ms = 0, value = 0 },
                { time_ms = 70, value = -10 },
                { time_ms = 300, value = 0 },
            },
        }},
    },
    sentinel_idle = {
        duration_ms = 2400,
        clock_source = timeline_clock.frame,
        playback_mode = 'loop',
        tracks = {
            {
                kind = 'value',
                path = { 'bob' },
                interpolation = 'linear',
                keys = {
                    { time_ms = 0, value = 0 },
                    { time_ms = 1200, value = 4 },
                    { time_ms = 2400, value = 0 },
                },
            },
            {
                kind = 'value',
                path = { 'spin' },
                interpolation = 'linear',
                keys = {
                    { time_ms = 0, value = 0 },
                    { time_ms = 2400, value = 6.283185 },
                },
            },
        },
    },
    intercept_open = {
        duration_ms = 140,
        tracks = {{
            kind = 'value',
            path = { 'opening' },
            interpolation = 'linear',
            keys = {
                { time_ms = 0, value = 0 },
                { time_ms = 140, value = 1 },
            },
        }},
    },
    sentinel_block = {
        duration_ms = 260,
        tracks = {
            {
                kind = 'value',
                path = { 'opening' },
                interpolation = 'linear',
                keys = {
                    { time_ms = 0, value = 1 },
                    { time_ms = 260, value = 0 },
                },
            },
            {
                kind = 'value',
                path = { 'recoil' },
                interpolation = 'linear',
                keys = {
                    { time_ms = 0, value = 0 },
                    { time_ms = 60, value = -6 },
                    { time_ms = 260, value = 0 },
                },
            },
        },
    },
}

return poses
