"""Bake stationary canal reflections into shared 8x8 SCREEN 2 patterns."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

# Motion of the two ends of a short ripple over one breath of the surface.
# Each starts and ends within one pixel of its rest position. The far side
# moves slightly later, causing the reflected stroke to stretch and shorten.
SWAY=(0,0,1,1,0,0,-1,-1)
STRETCH=(0,1,1,0,0,-1,-1,0)
PHASE_OFFSETS=(0,3,7,2,5,1,6,4)
BLUE_TIMING={4:(0,0,2,2,0,0,6,6),5:(0,1,2,2,0,5,6,6)}
FULL_TIMING=tuple(range(8))

# The warm reflection crosses several small wavelets. Its upper and lower
# highlights bend at different times, maintaining a column below the lamp.
# These silhouettes are drawn as left edge + length in one native character.
WARM={
    0:((3,5),(3,5),(4,4),(5,3),(4,4),(3,5),(2,6),(2,6)),
    2:((4,3),(4,4),(5,3),(5,2),(4,3),(3,3),(3,4),(4,3)),
    3:((3,5),(3,5),(4,4),(4,4),(3,5),(2,6),(2,5),(3,4)),
    4:((4,4),(4,3),(4,4),(3,4),(3,5),(3,4),(4,3),(4,4)),
    6:((4,4),(3,4),(2,4),(2,3),(3,3),(4,4),(5,3),(5,3)),
    7:((4,4),(3,5),(3,4),(3,4),(4,4),(5,3),(5,3),(4,4)),
}

def poses(base,warm):
    all_frames=[base.copy() for _ in range(8)]
    for y,row in enumerate(base):
        inks=np.unique(row)
        if len(inks)==1:continue
        background,light=map(int,inks)
        if warm:
            if y not in WARM:continue
            for phase,(start,length) in enumerate(WARM[y]):
                all_frames[phase][y,:]=background
                all_frames[phase][y,start:start+length]=light
            continue
        # Endpoints shared with a neighbouring tile stay fixed. This keeps long
        # highlights continuous across the seams of the four-tile modules.
        pattern=row==light
        transitions=np.diff(np.r_[False,pattern,False].astype(np.int8))
        spans=list(zip(np.flatnonzero(transitions==1),np.flatnonzero(transitions==-1)))
        # Dark blue strokes linger between crests. Only the brighter
        # reflections use every intermediate drawing.
        timing=BLUE_TIMING.get(light,FULL_TIMING)
        for phase,frame in enumerate(all_frames):
            frame[y,:]=background
            step=timing[phase]
            for start,end in spans:
                if end-start==1:
                    frame[y,start]=light
                    continue
                direction=1 if (y//2+start//3)%2==0 else -1
                left_delta=direction*(SWAY if y%2==0 else STRETCH)[step]
                right_delta=direction*(STRETCH if y%2==0 else SWAY)[step]
                left=0 if start==0 else min(6,max(1,start+left_delta))
                right=8 if end==8 else min(7,max(left+1,end+right_delta))
                frame[y,left:right]=light
    assert np.array_equal(all_frames[0],base)
    return all_frames

def compile_water(root,catalog,tiles,entries,cells,owners):
    source_ids=sorted({tile for row,materials in zip(cells,owners)
                       for tile,material in zip(row,materials) if tile!=1 and material.startswith('reuse_watergroep_')})
    palette=np.asarray([(0,0,0)]+[tuple(bytes.fromhex(s[1:])) for s in catalog['palette']],np.uint8)
    by_rgb={tuple(color):i for i,color in enumerate(palette)}
    def indices(im):
        return np.array([by_rgb[c] for c in im.get_flattened_data()],np.uint8).reshape(8,8)
    native={k:indices(tiles[k]) for k in source_ids}
    drawings={k:poses(a,entries[k]['asset']=='nls_0127') for k,a in native.items()}
    known={a.tobytes():entries[k]['asset'] for k,a in native.items()}
    base_names=set(known.values())
    frames={}
    new_patterns=[]
    for k,sequence in drawings.items():
        names=[]
        for phase in sequence:
            key=phase.tobytes()
            if key not in known:
                name='gracht_%03d'%len(new_patterns)
                known[key]=name
                new_patterns.append(phase)
                Image.fromarray(palette[phase]).save(root/'res/img'/(name+'@atlas=gameplay.png'))
            names.append(known[key])
        if len(set(names))>1:
            assert names[0]==entries[k]['asset']
            frames[entries[k]['asset']]=names
    # An animation belongs to water artwork only. The level map remains the
    # sole source of placement, occlusion, native collision and actor symbols.
    assert all(material.startswith('reuse_watergroep_') for row,materials in zip(cells,owners)
               for k,material in zip(row,materials) if entries[k]['asset'] in frames)
    live={name for names in frames.values() for name in names}
    for f in (root/'res/img').glob('gracht_*@atlas=gameplay.png'):
        if f.name.split('@')[0] not in live:f.unlink()
    output=root/'authoring/gracht';output.mkdir(exist_ok=True)
    bank=[];by_bytes={};by_name={}
    for sequence in drawings.values():
        for phase in sequence:
            key=phase.tobytes()
            if key not in by_bytes:
                by_bytes[key]=len(bank);bank.append(phase)
            by_name[known[key]]=by_bytes[key]
    patterns=bytearray();colours=bytearray()
    for tile in bank:
        for row in tile:
            inks=np.unique(row);assert len(inks)<=2
            upper,lower=int(inks[-1]),int(inks[0]);colours.append(upper*16+lower)
            patterns.append(sum(128>>x for x,v in enumerate(row) if upper!=lower and v==upper))
    (output/'patronen.bin').write_bytes(patterns);(output/'kleuren.bin').write_bytes(colours)
    first_row=next(y for y,materials in enumerate(owners,1) if any(s.startswith('reuse_watergroep_') for s in materials))
    table={'first_row':first_row,'ticks_per_pose':6,'phase_offsets':list(PHASE_OFFSETS),'frames':frames}
    info={'original_water_tiles':len(native),'animated_families':len(frames),'additional_tiles':len(live-base_names),
          'hardware_patterns':len(bank),'ticks_per_pose':6,'phases':8,'phase_offsets':list(PHASE_OFFSETS),
          'tile_indices':by_name,'frames':{name:[by_name[x] for x in seq] for name,seq in frames.items()}}
    (output/'water.json').write_text(json.dumps(info,indent=2)+'\n')
    return table
