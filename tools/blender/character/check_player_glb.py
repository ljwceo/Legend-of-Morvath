# Phase A, step A.2c: checks player.glb (made by 04_export_player.py).
# Standard library only, so it runs anywhere:
#   python check_player_glb.py <player.glb>
#   blender -b --factory-startup --python check_player_glb.py -- <player.glb>
#
# Prints the bones, skinned meshes, triangles, every clip with its duration and the file size,
# then OK or the list of problems (exit code 1). 04_export_player.py imports check() and also
# compares the clip durations with the Blender Actions.
import json, os, struct, sys

BONES = 74                     # 65 Mixamo bones + Cape_L/M/R 1-3
TRIANGLE_LIMIT = 30000
SIZE_LIMIT = 2 * 1000 * 1000   # bytes
FPS = 30
# The clip names the game asks for (step A.3); every Action becomes one clip with exactly this name.
CLIPS = [
    'Idle', 'Walk', 'Run', 'Sprint', 'Jump_Start', 'Jump_Air', 'Land', 'Dash', 'Dash_Recover',
    'Slash_1', 'Slash_2', 'Slash_3', 'Heavy_Windup', 'Heavy_Strike', 'Cast_Gather', 'Cast_Release',
    'Hit', 'Death', 'Interact', 'Walk_Sword', 'Run_Sword', 'Idle_Sword', 'Idle_Sword_2',
    'Idle_Sword_3',
]


def read_gltf(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2:
        raise ValueError('%s is not a glTF 2 binary' % path)
    chunk_length, chunk_type = struct.unpack_from('<I4s', data, 12)
    if chunk_type != b'JSON':
        raise ValueError('first chunk is not JSON')
    return json.loads(data[20:20 + chunk_length].decode('utf-8')), len(data)


def check(path, durations=None, out=print):
    """Prints the report; returns a list of problems (empty = OK).
    `durations`: {clip name: seconds} to compare with (one frame of slack)."""
    gltf, size = read_gltf(path)
    problems = []
    accessors = gltf.get('accessors', [])
    nodes = gltf.get('nodes', [])
    skins = gltf.get('skins', [])

    joints = [nodes[j].get('name', '?') for j in skins[0]['joints']] if skins else []
    out('bones %d (skins %d)' % (len(joints), len(skins)))
    out('  ' + ', '.join(joints))
    if len(skins) != 1:
        problems.append('expected 1 skin, found %d' % len(skins))
    if len(joints) != BONES:
        problems.append('expected %d bones, found %d' % (BONES, len(joints)))

    triangles = 0
    for node in nodes:
        if 'mesh' not in node:
            continue
        tris = 0
        for prim in gltf['meshes'][node['mesh']]['primitives']:
            if prim.get('mode', 4) != 4:
                continue
            count = accessors[prim['indices']]['count'] if 'indices' in prim else \
                accessors[prim['attributes']['POSITION']]['count']
            tris += count // 3
        triangles += tris
        out('mesh %-14s %6d triangles%s' % (node.get('name', '?'), tris,
                                            ', skinned' if 'skin' in node else ''))
    out('triangles %d, limit %d' % (triangles, TRIANGLE_LIMIT))
    if triangles > TRIANGLE_LIMIT:
        problems.append('too many triangles: %d' % triangles)

    clips = {}
    for anim in gltf.get('animations', []):
        end = 0.0
        for ch in anim['channels']:
            end = max(end, accessors[anim['samplers'][ch['sampler']]['input']]['max'][0])
        clips[anim.get('name', '?')] = (end, len(anim['channels']))
    out('clips %d' % len(clips))
    for name in CLIPS + sorted(set(clips) - set(CLIPS)):
        if name not in clips:
            out('  %-14s MISSING' % name)
            continue
        seconds, channels = clips[name]
        note = ''
        if durations and name in durations and abs(durations[name] - seconds) > 1.0 / FPS + 1e-4:
            note = '  (Blender: %.3f s)' % durations[name]
            problems.append('%s lasts %.3f s, Blender %.3f s' % (name, seconds, durations[name]))
        out('  %-14s %6.3f s  %3d channels%s' % (name, seconds, channels, note))
    missing = [c for c in CLIPS if c not in clips]
    extra = sorted(set(clips) - set(CLIPS))
    if missing:
        problems.append('missing clips: ' + ', '.join(missing))
    if extra:
        problems.append('unexpected clips: ' + ', '.join(extra))

    used = gltf.get('extensionsUsed', [])
    out('extensions %s' % (', '.join(used) or 'none'))
    out('size %d bytes (%.2f MB), limit %.2f MB' % (size, size / 1e6, SIZE_LIMIT / 1e6))
    if size > SIZE_LIMIT:
        problems.append('file too big: %.2f MB' % (size / 1e6))
    out('OK' if not problems else 'NOT OK:\n  ' + '\n  '.join(problems))
    return problems


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    if not args:
        raise SystemExit('usage: python check_player_glb.py <player.glb>')
    sys.exit(1 if check(os.path.abspath(args[0])) else 0)
