# BadCharacters rig & export contract

Everything a game engine needs to know about a `.glb` from BadCharacters.

## Space

| | |
|---|---|
| Units | metres |
| Up | +Y |
| Forward | +Z (the character looks down +Z) |
| Character's left | +X |
| Origin | between the feet, on the floor; soles sit exactly on y = 0 |
| Rest pose | T-pose (default) or A-pose (38° down), per recipe |

## Skeleton

25 joints, **named exactly like Unity's `HumanBodyBones`**, so Unity Humanoid, Godot's
`SkeletonProfileHumanoid`, Unreal's IK Retargeter and most retargeting tools map them
automatically:

```
Root
└─ Hips
   ├─ Spine ─ Chest ─ UpperChest ─┬─ Neck ─ Head
   │                              ├─ LeftShoulder ─ LeftUpperArm ─ LeftLowerArm ─ LeftHand ─ LeftThumbProximal
   │                              └─ RightShoulder ─ … (mirror)
   ├─ LeftUpperLeg ─ LeftLowerLeg ─ LeftFoot ─ LeftToes
   └─ RightUpperLeg ─ … (mirror)
```

- **Every bone's rest rotation is identity.** Bones are pure translations from their parent, so
  a bone's local rotation *is* its rotation away from the rest pose, expressed in world axes.
- `Root` stays at the origin and is never animated. Use it for root motion if you add your own.
- `Hips` carries the only translation channel (bob, crouch, jump height). Clips are in place, except
  the traversal clips (`Vault`, `ClimbOver`, `Dive`), whose hips travel; each one's `extras.travel`
  says where the hips end up (metres, +Z forward), so move your character controller by that much
  when the clip ends (or use root motion from `Hips`).

## Sockets

Plain child nodes (not skin joints) for attaching items at runtime:

| Socket | Parent bone | Where |
|---|---|---|
| `Socket_LeftHand`, `Socket_RightHand` | hands | centre of the grip |
| `Socket_HeadTop` | Head | crown, for hats you add yourself |
| `Socket_Back` | UpperChest | between the shoulder blades |
| `Socket_LeftHip`, `Socket_RightHip` | Hips | holster / sword positions |

## Mesh

- One skinned mesh, one primitive per material (`Skin`, `Face`, one per garment slot plus its accent).
- Up to 4 influences per vertex, weights normalised. Joint indices are `UNSIGNED_BYTE`.
- The body is built from closed, outward-facing lofts. Clothing is a set of shells that copy the
  body's skin weights ring-for-ring, so clothes bend exactly where the body bends.
- `Face` uses a 128×64 pixel-art texture with **NEAREST** filtering, wrapped cylindrically
  around the head (front of the face = u 0.5).
- Optional **morph targets** `Fat+`, `Fat-`, `Muscle+`, `Muscle-` (all default weight 0) let a
  game reshape the character at runtime without regenerating. Names are in `mesh.extras.targetNames`.
- **Polygon budget** (medium detail): 1.7k–4.0k triangles, median 2.7k. Low: 1.5k–2.8k.
  Geometry fully hidden under a thicker layer is never exported; cut edges stay tucked at least a
  quarter ring under the covering layer, which shares their skin weights, so they stay hidden in
  every pose. Voxel pieces (hair chunks, buckles, straps) are 12-triangle boxes with hard edges.
- Props (the staff) are part of the skinned mesh, 100 % weighted to `RightHand`, in their own
  `Prop_*` material, so you can hide them by material.

## Animation clips

| Clip | Loop | Notes |
|---|---|---|
| `Idle` | ✅ | 3 s breathing, weight shift, look-around |
| `Walk`, `Run` | ✅ | cycle length scales with leg length |
| `Jump` | ❌ | crouch → launch → land → recover, 1.3 s |
| `Wave`, `Punch` | ✅ | right hand |
| `Crouch`, `CrouchWalk` | ✅ | feet stay planted (hip drop solved from leg lengths) |
| `ClimbUp`, `ClimbDown` | ✅ | wall climb facing +Z; Down is Up played backwards |
| `ClimbLeft`, `ClimbRight` | ✅ | ledge shimmy |
| `LadderUp`, `LadderDown` | ✅ | hands on rungs; Down is Up backwards |
| `Swim` | ✅ | front crawl, body horizontal, flutter kick |
| `Craft` | ✅ | generic hammering at a bench |
| `BowShoot` | ✅ | bow in the left hand; drives `BowString` if exported |
| `CrossbowShoot` | ✅ | shouldered aim, recoil, lower to reload |
| `RifleAim`, `RifleReady` | ✅ | shouldered with breathing sway / low ready |
| `ZombieWalk` | ✅ | reaching arms, dragged left foot |
| `Sprint` | ✅ | flat-out run, stronger lean and arm drive |
| `Vault` | ❌ | two-handed vault over a waist-high obstacle (0.85 × hip height); `extras.travel` ≈ 1.5 × hip height forward |
| `ClimbOver` | ❌ | grab, pull up, kneel on top, drop down the far side of a wall ≈ 1.4 × hip height; `extras.travel` ≈ 1.35 × hip height |
| `Slide` | ❌ | running slide: drop in, lead leg out, trailing hand down, get up. In place (the game drives the speed) |
| `Float` | ✅ | treading water upright; water line around the chest |
| `Dive` | ❌ | dive from an edge into water, head first; `extras.travel` goes forward and down |
| `SwimUnderwater` | ✅ | diver style: body flat, arms back along the sides, slow flutter kick |
| `RestPose` | ✅ | the bind pose |

Baked at 30 fps, `LINEAR` interpolation, then **keyframe-reduced** (keys that linear interpolation
reproduces within 0.15° / 0.5 mm are dropped; first and last keys always kept so loops stay
seamless). Rotation channels on every bone, `Hips` translation, and a `BowString` translation track
in every clip when that bone exists. Each animation's `extras.loop` says whether it loops.
Hunched races (goblins, gremlins, mutants) bake their posture into every clip.

**Props are animation-independent.** Hand props are not exported unless the recipe has
`mesh.exportProps: true`; every clip is always exported. Attach your own weapons to
`Socket_LeftHand` / `Socket_RightHand`.

## Metadata

`scenes[0].extras.badcharacters` holds the schema version, axis conventions, the humanoid bone
map, socket names, morph target names, clip list, and **the full recipe**, so any exported GLB
can be turned back into an editable character.

## Engine notes

- **Unity**: import the GLB with glTFast or UnityGLTF, set the rig to Humanoid. The bone names
  auto-map. Enable *Loop Time* on the looping clips if your importer doesn't read `extras.loop`.
- **Godot 4**: drag in the GLB. In the import dock, use a `BoneMap` with the Humanoid profile
  (auto-fills from these names) for retargeting. Set loop mode on the looping clips.
- **Unreal 5**: import the GLB through Interchange. For retargeting, create an IK Rig on the
  skeleton; the chains follow the standard humanoid layout.
- **Blender**: File → Import → glTF 2.0. Shape keys show up under Object Data → Shape Keys.

Honest status: the files pass the Khronos glTF validator with zero errors and warnings, and
load and animate in three.js (the viewer renders the exported GLB itself). **Godot 4: confirmed**
by Tom, with generated characters walking on Solitude's title screen (skinning and baked clips
intact). Unity and Unreal have not been tried yet; please report anything odd.
