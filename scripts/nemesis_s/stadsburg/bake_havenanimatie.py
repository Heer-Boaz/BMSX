"""Compile Stadsburg's wind and cargo poses on the native 8×8 grid."""
import json
from PIL import Image
from bake_stadsgroen import assembled, greenery_poses, greenery_steps, TREE_BRANCHES

# Coordinates in two adjacent characters, measured from the leeward roof edge.
# The trailing grains lift first; the last few fall apart at the end of the gust.
SNOW = (
    (),
    ((0,6,15),(1,6,15),(2,6,15),(2,5,15),(3,5,15),(4,6,15),(5,4,7)),
    ((1,6,7),(3,6,7),(4,5,15),(5,5,15),(5,4,7),(7,5,15),(8,3,7),(10,4,7)),
    ((7,6,7),(9,4,7),(10,4,7),(12,2,7),(14,5,7)),
)


def compile_harbor(root, plan, prefabs, tiles, entries, cells, placements, palette_hex, greenery_layers=()):
    palette = [(0,0,0)] + [tuple(bytes.fromhex(c[1:])) for c in palette_hex]
    rgb_to_index = {c:i for i,c in enumerate(palette)}
    rgb_to_index[(0,0,0)] = 1
    directory = root/'authoring/havenanimatie'
    directory.mkdir(exist_ok=True)
    blank = tiles[1]; patterns = []; ids = {}; variants = {}; clips = []
    sources = {e['asset']:tiles[k] for k,e in entries.items()}
    wind_bank = []

    def pattern(name):
        if name is None: return 0
        if name not in ids:
            patterns.append(name); ids[name] = len(patterns)
        return ids[name]

    def original(k):
        return None if k == 1 else entries[k]['asset']

    def baked(im, base):
        if im.tobytes() == tiles[base].tobytes(): return original(base)
        key = (im.tobytes(), base==1)
        if key not in variants:
            name = f'havenanim_{len(variants):03d}'
            variants[key] = name; sources[name] = im
            art = im.convert('RGBA')
            if base==1: # Blank stage cells expose the cartridge's starfield.
                art.putalpha(im.convert('L').point(lambda v:255 if v else 0))
            art.save(root/'res/img'/(name+'@atlas=gameplay.png'))
            wind_bank.append((name, im))
        return variants[key]

    def add_clip(label, positions, poses, durations, start, end, once=False, moving=()):
        # positions are in world tiles. Each pose provides only the departures
        # from the authored map. Zero resolves to the native empty map cell.
        group = []
        for x,y in sorted(positions, key=lambda p:(p[1],p[0])):
            base = original(cells[y][x]); paths = [pattern(p.get((x,y),base)) for p in poses]
            if len(set(paths))>1:
                assert paths[0]==pattern(base)
                group.append([x+1,y+1,int((x,y) in moving),*paths])
        assert group and all(1<=pose<=len(poses) and ticks>0 for pose,ticks in durations)
        clips.append(dict(label=label,start=start,end_column=end,once=once,cells=group,steps=durations))

    settings=plan['animations']; snow_sites=settings['snow_edges']; samples={}
    for place in placements:
        name=place['prefab']
        if name not in snow_sites:continue
        dx,dy=snow_sites[name]; x=place['at'][0]+dx; y=place['at'][1]+dy
        positions=[(x,y),(x+1,y)]; poses=[]
        for flakes in SNOW:
            phase={}
            for k,(cx,cy) in enumerate(positions):
                base=cells[cy][cx]; im=tiles[base].copy()
                for sx,sy,ink in flakes:
                    if sx//8==k:
                        assert im.getpixel((sx%8,sy))==(0,0,0),(name,cx,cy)
                        im.putpixel((sx%8,sy),palette[ink])
                phase[cx,cy]=baked(im,base)
            poses.append(phase)
        # These durations are game updates (one update ≈ 40 ms).
        add_clip('sneeuw_'+str(x),positions,poses,[[1,30+((x-plan['harbor']['art_origin'])%7)*3],[2,4],[3,4],[4,5]],x-31,x+1)
        samples.setdefault('dak',([x-2,y-1,5,3],poses))

    for place in placements:
        if place['prefab']!='compact_winterlinde':continue
        ox,oy=place['at']
        tree=assembled('compact_winterlinde',prefabs,tiles)
        drawings=greenery_poses('compact_winterlinde',tree)
        positions={(ox+u,oy+v) for v in range(tree.height//8) for u in range(drawings[0].width//8)
                   if len({drawing.crop((8*u,8*v,8*u+8,8*v+8)).tobytes() for drawing in drawings})>1}
        poses=[]
        for frame in drawings:
            phase={}
            for cx,cy in positions:
                u,v=cx-ox,cy-oy
                im=frame.crop((8*u,8*v,8*u+8,8*v+8))
                phase[cx,cy]=baked(im,cells[cy][cx])
            poses.append(phase)
        add_clip('linde',positions,poses,greenery_steps('compact_winterlinde',ox,plan['harbor']['art_origin']),ox-31,ox+4)
        samples['linde']=([ox,oy,4,6],poses)

    greenery_proof=[]
    for layer in greenery_layers:
        name=layer['prefab'];x=layer['x'];positions=layer['positions'];poses=[]
        fixed=1 if name=='sneeuwstruik' else 2 if name=='sneeuwhaag' else 12 if name=='winterlinde_stil' else 8
        fixed_y=layer['baseline']-fixed
        for raw_pose in layer['poses']:
            phase={}
            for cx,cy in positions:
                image=raw_pose[cx,cy]
                assert all(len({image.getpixel((px,py)) for px in range(8)})<=2 for py in range(8)),(name,cx,cy)
                for py in range(8):
                    if cy*8+py>=fixed_y:
                        assert all(image.getpixel((px,py))==tiles[cells[cy][cx]].getpixel((px,py))
                                   for px in range(8)),(name,cx,cy,'moving foot or trunk')
                phase[cx,cy]=baked(image,cells[cy][cx])
            poses.append(phase)
        assert all(layer['poses'][0][cx,cy].tobytes()==tiles[cells[cy][cx]].tobytes()
                   for cx,cy in positions),(name,x,'rest differs from stage')
        durations=greenery_steps(name,x,plan['harbor']['art_origin'])
        label='groen_'+str(x)
        add_clip(label,positions,poses,durations,x-31,x+layer['bounds'][2])
        samples.setdefault('groen_'+name,(layer['bounds'],poses))
        greenery_proof.append({'label':label,'prefab':name,'column':x,'pixel_origin':layer['pixel_origin'],
                               'poses':len(poses),'cycle_updates':sum(ticks for pose,ticks in durations),
                               'changed_native_cells':len(positions),'max_horizontal_shift':2 if name=='winterlinde_stil' else 1,
                               'vertical_shift':1 if name in TREE_BRANCHES else 0,
                               'fixed_lower_rows':fixed,'trunk_and_ground_unchanged':True,
                               'rest_matches_stage':True,'max_colors_per_8x1':2,
                               'fixed_background_rows':layer['background_rows']})
    (root/'authoring/stadsgroen/windcontrole.json').write_text(json.dumps({
        'new_clips':greenery_proof,'original_linden_clip':'linde','greenery_clips':len(greenery_proof)+1,
        'runtime_module':'carts/nemesis_s/havenanimatie.lua',
        'runtime_module_unchanged':True,'background_is_not_translated':True,
        'tree_motion':'secondary branches rotate around fixed forks with overlapping gust response and separate settling; trunk and main limbs stay fixed',
        'tree_cycle_updates':76,
        'rigid_masks':{name:'authoring/stadsgroen/rigid_'+('winterlinde_stil' if name=='compact_winterlinde' else name)+'.png'
                       for name in TREE_BRANCHES},
        'motion_reference':'https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-6-gpu-generated-procedural-wind-animations-trees',
    },indent=2,ensure_ascii=False)+'\n')

    # A beam retains its snow cap and its bracket. Only the lens underneath
    # changes. Two inks per character scanline, including the hottest frame.
    def lamp(base, power):
        im=tiles[base].copy()
        if power:
            panel=im.getpixel((0,4))
            rings=([(4,3,4,10),(5,3,4,10)] if power==1 else
                   [(3,3,4,10),(4,2,5,10),(5,2,5,11),(6,3,4,10)] if power==2 else
                   [(3,2,5,10),(4,1,6,10),(5,2,5,15),(6,2,5,10)])
            for yy,x0,x1,ink in rings:
                for xx in range(8):im.putpixel((xx,yy),palette[ink] if x0<=xx<=x1 else panel)
        return baked(im,base)

    for p in plan['hanging']:
        if 'travel' not in p:continue
        ox,y=p['x'],p['y']; x=ox+5; travel=p['travel']; rows=prefabs[p['prefab']]['tiles']
        # Use the actual supporting chain, hook and twelve cargo tiles.
        chain=original(rows[1][5]); hook=original(rows[4][5]); mass=rows[5:9]
        positions={(x,y)}; moving={(cx,cy) for cy in range(y+4,y+9+travel) for cx in range(x-1,x+2)}
        positions.update(moving); drawings=[]; unique={}
        def pose(depth,light):
            key=depth,light
            if key in unique:return unique[key]
            phase={(x,y):lamp(cells[y][x],light)}
            for cx,cy in moving:
                row=cy-y-4-depth; col=cx-x+1
                art=None
                if row<0 and col==1:art=chain
                if row==0 and col==1:art=hook
                if 1<=row<=4:art=original(mass[row-1][col+4])
                phase[cx,cy]=art
                if not depth:assert art==original(cells[cy][cx]),(cx,cy,art)
            drawings.append(phase);unique[key]=len(drawings);return len(drawings)
        # The swept area is free sky in these two spans. Tile roles come from
        # the existing stage cells at rest, including the native chain and hook.
        assert all(cells[cy][cx]==1 for cx,cy in moving if cy>=y+9)
        rest=pose(0,0);steps=[[rest,1],[pose(0,1),5],[pose(0,2),5],[pose(0,3),9]]
        for d in range(1,travel+1): steps.append([pose(d,2),6 if d<travel else p['hold']])
        for d in reversed(range(travel)): steps.append([pose(d,1),7])
        steps.append([rest,1]);add_clip('lier_'+str(ox),positions,drawings,steps,x-p['engage_at'],x+1,True,moving)
        if travel==4:samples['lier']=([ox,y,8,9+travel],[drawings[i-1] for i in [rest,pose(0,3),pose(2,2),pose(4,2)]])
    clips.sort(key=lambda c:c['start'])
    live={name for name,_ in wind_bank}
    for f in (root/'res/img').glob('havenanim_*@atlas=gameplay.png'):
        if f.name.split('@')[0] not in live:f.unlink()
    bits=bytearray(); colours=bytearray()
    for name,im in wind_bank:
        for yy in range(8):
            row=[rgb_to_index[im.getpixel((xx,yy))] for xx in range(8)]; inks=sorted(set(row));assert len(inks)<=2,(name,yy,inks)
            a,b=inks[0],inks[-1];bits.append(sum(128>>xx for xx,v in enumerate(row) if v==b and a!=b));colours.append(16*b+a)
    (directory/'patronen.bin').write_bytes(bits);(directory/'kleuren.bin').write_bytes(colours)
    (directory/'patronen.json').write_text(json.dumps([n for n,_ in wind_bank],indent=2)+'\n')
    for key,(box,poses) in samples.items():
        left,top,w,h=box; strip=Image.new('RGB',((w*8+2)*len(poses)-2,h*8))
        for i,frame in enumerate(poses):
            for v in range(h):
                for u in range(w):
                    cx,cy=left+u,top+v;name=frame.get((cx,cy),original(cells[cy][cx]));
                    strip.paste(sources[name] if name else blank,(i*(w*8+2)+u*8,v*8))
        strip.save(directory/(key+'.png'))
    # A transparent atlas cell keeps a fixed slot even when the mechanism
    # exposes sky. Replacing art then never rebuilds a whole terrain row.
    empty='havenanim_leeg'
    Image.new('RGBA',(8,8)).save(root/'res/img'/(empty+'@atlas=gameplay.png'))
    return {'empty':empty,'patterns':patterns,'clips':clips}
