-- Sparse stage-local ROM tape produced with the authored stage. Direct mapped
-- reads admit retained render rows; only mutable collision words enter RAM.
local tape<const> = {}

function tape.open(address)
    local header<const>: *word = address
    return {
        address=address, width=header[0], height=header[1],
        foreground=address+header[2], background=address+header[3],
        background_rows=header[4], collision=address+header[5],
        collision_words=header[6], water=address+header[7], water_count=header[8],
        actors=address+header[9], actor_count=header[10],
    }
end

function tape.bind_rows(view, directory, height, tiles)
    local rows<const>: *word = directory
    for y=1,height do
        local row<const> = tiles._rows[y]
        row.tape_address = view.address + rows[(y-1)*2]
        row.tape_count = rows[(y-1)*2+1]
    end
end

function tape.collision_rows(view)
    local source<const>: *word = view.collision
    local rows<const> = {}
    local cursor=0
    for y=1,view.height do
        local row<const> = {}
        for word=1,view.collision_words do
            row[word]=source[cursor]
            cursor=cursor+1
        end
        rows[y]=row
    end
    return rows
end

return tape
