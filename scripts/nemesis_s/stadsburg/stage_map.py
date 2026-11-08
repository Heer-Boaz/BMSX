"""Compile runtime role indexes from the single authored terrain/actor map."""

ACTOR_SYMBOLS = {
    'formation_down': 'p', 'formation_up': 'P', 'red_mitre': 'M',
    'blue_mitre': 'm', 'chimney': 'S', 'smoke': 'R', 'quay_cannon': 'D',
    'turret_blue_floor': 'B', 'turret_red_floor': 'C',
    'turret_blue_ceiling': 'b', 'turret_red_ceiling': 'c',
    'sack': 'Z', 'snowman': 'N', 'bell': 'K', 'mill': 'W', 'moon': "'",
}


def compile_actor_cells(rows, roles):
    actor_roles = {ord(symbol) for symbol in ACTOR_SYMBOLS.values()}
    cells = []
    # Match stage admission order, including ties within each column.
    for x in range(len(rows[0])):
        for y, row in enumerate(rows):
            tile_id = row[x]
            if tile_id:
                role = roles[tile_id - 1]
                if role in actor_roles:
                    cells.append([x + 1, y + 1, role])
    return cells
