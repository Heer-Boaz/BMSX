"""Cook the authored Nemesis presentation step tracks into ordered ROM lanes."""

from pathlib import Path
from struct import pack, pack_into


# Content-to-content VBlank intervals measured with Nemesis 2 on a 50 Hz MSX1.
# The custom pictures and captions preserve the corresponding panel cadence.
STORY_DURATIONS = (1257, 538, 480, 419, 367, 1014, 2101, 1202, 839)
REVEAL = tuple(zip((0, 8, 9, 10, 12, 13, 15, 16, 18), range(9)))
TITLE_IDLE_DURATION = 24
HANGAR_DURATION = 194
LIFT_DURATION = 58


def curtain_count(start, offsets):
    return [(0, 0), *((start + offset, i) for i, offset in enumerate(offsets, 1))]


def even_boundary(start, end, index, divisions):
    return start + (index * (end - start) + divisions - 1) // divisions


def normal_story(length):
    exit_start = length - 86 - 15
    return (
        REVEAL,
        curtain_count(exit_start, (0, 11, 22, 33, 43, 54, 65, 75)),
        ((0, 0), (exit_start, 1)),
    )


def venom_story():
    # The portrait starts at 126, is fully open at 158, closes over 246..310
    # and wipes at 330..630. The caption then reveals over 651..663.
    opening_start = [(0, 126), (126, 126)]
    opening_end = [(0, 110), (126, 110)]
    for step in range(1, 7):
        frame = even_boundary(126, 158, step, 6)
        opening_start.append((frame, 126 - step * 8))
        opening_end.append((frame, 110 - step * 8))
    for step in range(1, 7):
        frame = even_boundary(246, 310, step - 1, 5)
        opening_start.append((frame, 78 + step * 8))
        opening_end.append((frame, 62 + step * 8))
    opening_end.extend((even_boundary(330, 630, step - 1, 105), 110 - step)
                       for step in range(1, 107))
    secondary = [(0, 0), *((even_boundary(651, 663, i, 7), i + 1) for i in range(8))]
    return (
        REVEAL,
        ((0, 0), (126, 1)),  # Portrait hidden/visible
        opening_start,
        opening_end,
        secondary,
        curtain_count(961, (0, 6, 12, 18, 24, 30, 36, 42)),
        ((0, 0), (126, 2), (631, 0), (961, 1)),  # No curtain, portrait, slide
    )


def clips():
    yield from ((length, venom_story() if i == 6 else normal_story(length))
                for i, length in enumerate(STORY_DURATIONS, 1))
    yield TITLE_IDLE_DURATION, (((0, 1), (8, 2), (12, 1), (20, 2)), ((0, 1), (12, 0)))
    # Nonuniform lift lighting follows the original 50 Hz presentation.
    yield HANGAR_DURATION, (tuple((frame, i % 2 + 1) for i, frame in enumerate(
        (0, 4, 21, 39, 57, 74, 90, 106, 122, 138, 154, 170, 187))),)
    yield LIFT_DURATION, (tuple(zip((0, 4, 13, 22, 31, 40, 49), range(0, -56, -8))),)


def compile_clip(length, tracks):
    # Stable sorting preserves equal-frame authoring order inside tracked lanes.
    ordered = [sorted(keys, key=lambda key: key[0]) for keys in tracks]
    directory, keys = [], []
    forward, reverse = [[] for _ in range(length)], [[] for _ in range(length)]
    for track, track_keys in enumerate(ordered, 1):
        first = len(keys)
        for frame, value in track_keys:
            if not 0 <= frame < length:
                raise ValueError(f'Key frame {frame} outside clip of length {length}')
            index = len(keys)
            keys.append((frame, value))
            forward[frame].append((track, index))
            if index != first:
                reverse[frame].append((track, index - 1))
        directory.append((first, len(keys)))

    operations = []

    def spans(buckets):
        offsets = []
        for bucket in buckets:
            offsets.append(len(operations))
            operations.extend(bucket)
        return pack(f'<{len(offsets) + 1}H', *offsets, len(operations))

    forward_spans = spans(forward)
    reverse_spans = spans(reverse)
    planes = (
        b''.join(pack('<HH', *track) for track in directory),
        b''.join(pack('<Ii', *key) for key in keys),
        b''.join(pack('<HH', *op) for op in operations),
        forward_spans,
        reverse_spans,
    )
    result = bytearray(24)
    offsets = []
    for plane in planes:
        result.extend(bytes(-len(result) % 4))
        offsets.append(len(result))
        result.extend(plane)
    pack_into('<6I', result, 0, length, *offsets)
    return result


def compile_presentation_steps():
    source = list(clips())
    result = bytearray(len(source) * 4)
    for index, (length, tracks) in enumerate(source):
        result.extend(bytes(-len(result) % 4))
        pack_into('<I', result, index * 4, len(result))
        result.extend(compile_clip(length, tracks))
    return bytes(result)


if __name__ == '__main__':
    target = Path(__file__).resolve().parents[2] / 'carts/nemesis_s/res/data/nemesis_s_presentation_steps.bin'
    target.write_bytes(compile_presentation_steps())
