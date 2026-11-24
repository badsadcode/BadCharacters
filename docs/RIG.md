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
| `Socket_LeftHand_Tool`, `Socket_RightHand_Tool` | hands | **oriented** tool mount: a shaft (sword, axe, staff, shovel, hammer, fishing rod) runs through the fist along the thumb. Tool +Z = toward its head / blade tip, +Y = the way the fingers point, origin in the palm. Every tool clip below keeps the tool on this axis |
| `Socket_LeftHand_Weapon`, `Socket_RightHand_Weapon` | hands | **oriented** weapon mount: parent a grip-origin weapon here (BadGun convention: origin on the trigger grip, +Z muzzle, +Y up) and it sits in the fist, barrel along the fingers, top along the thumb |

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
| `RockClimbUp`, `RockClimbDown` | ✅ | rock wall, facing +Z: arms spread wide to holds, knees turned out, opposite hand and foot together; Down is Up backwards |
| `RockClimbLeft`, `RockClimbRight` | ✅ | traversing a rock wall sideways, spread wide |
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
| `Crawl` | ✅ | hands and knees; body pitch solved so straight arms reach the floor, hands placed by IK |
| `CrawlProne` | ✅ | army crawl on the belly: forearms on the floor, one knee drawn up along the floor at a time |
| `CarryBagIdle`, `CarryBagWalk` | ✅ | a bag in the right hand, arm straight, body leaning away from the weight |
| `CarryDuffleIdle`, `CarryDuffleWalk` | ✅ | a duffle over the right shoulder, hand on the strap |
| `CarryBoxIdle`, `CarryBoxWalk` | ✅ | a box ~0.4 × body unit wide held in front with both hands, leaning back; the walk is 25 % slower |
| `OpenDoor` | ❌ | door in front: hinge 0.45·u to the left, handle 0.8·u from the hinge at 0.56·H, door plane 0.42·u ahead. Reach (0–0.45 s), press the handle (0.45–0.6 s), push it open 30° (0.7–1.45 s), let go |
| `CloseDoor` | ❌ | `OpenDoor` backwards: reach the open door's handle, pull it shut, let go |
| `PunchLeft/Right` + `High/Mid/Low` | ❌ | from a guard, a straight punch to head / chest / belly height on the centre line, torso twisting into it; low punches dip the knees |
| `KickLeft/Right` + `High/Mid/Low` | ❌ | front kick: chamber, snap out, re-chamber; leaning back more for higher kicks |
| `SwordSlash`, `SwordOverhead`, `SwordThrust` | ❌ | one-handed sword in the right hand (tool socket), lunging; the free hand out for balance |
| `StaffThrust`, `StaffSwing`, `StaffOverhead` | ❌ | two hands on a staff (right near the middle, left toward the front end) |
| `AxeChop` | ✅ | two-handed, wind up over the right shoulder, chop into a tree at hip height front-left |
| `ShovelDig` | ✅ | foot on the blade, push in, pry, lift, toss to the right |
| `Saw` | ✅ | hand saw at bench height, the other hand holding the board |
| `Hammer` | ✅ | driving a nail into a wall at chest height, the other hand holding the nail |
| `Weld` | ✅ | crouched, torch in the right hand moving along a seam, left hand steadying it |
| `FishCast` | ❌ | two-handed cast: rod back over the shoulder, whip forward |
| `FishIdle`, `FishReel` | ✅ | rod held up, waiting; or reeling (left hand cranking beside the grip) |
| `RideIdle`, `RideWalk`, `RideTrot`, `RideGallop` | ✅ | astride a horse: thighs around a ~0.5 m barrel, feet in stirrups, hands on the reins. The Hips stay at their rest height (plus the gait's bounce): **put the character's origin `props.originBelowSaddleSeat` below the saddle's seat point**. Trot posts; gallop leans forward |
| `DriveCar` | ✅ | seated, origin = the floor under the driver, feet toward the pedals (right foot works the accelerator). Hands at ten-to-two on a wheel of radius 0.17·u, centre 0.36·u ahead of the chest, tilted 25° back; the hands follow the rim as it turns (±~35°) |
| `DriveCart` | ✅ | on a horse cart's bench (origin = the footboard), reins in hand, bumping along |
| `PushCart` | ✅ | walking behind a handcart, hands on a crossbar at waist height, leaning in |
| `SitDown`, `StandUp` | ❌ | onto / off a chair, feet staying where the character stood; the seat is **behind** the origin, centred under the seated Hips |
| `SitIdle` | ✅ | on a chair, hands resting on the thighs |
| `SitEat`, `SitDrink`, `SitType` | ✅ | at a table: spoon from a bowl to the mouth / cup up, sip, down / typing on a keyboard |
| `Eat`, `Drink` | ✅ | standing: something hand-held to the mouth, chewing / a bottle tipped up, head back |
| `Talk` | ✅ | standing, hand gestures and nods |
| `SitGround` | ✅ | cross-legged on the floor, hands on the knees |
| `Sleep` | ✅ | lying on the back (head toward −Z), breathing, arms by the sides |
| `DeathForward`, `DeathBackward`, `DeathLeft`, `DeathRight` | ❌ | knees buckle, the body tips over around the feet (gravity speeds it up), a small bounce, ends lying flat on the front / back / side |
| `DeathCrumple` | ❌ | knees give way, kneels, slumps, topples onto its side |
| `DeathHeadshot` | ❌ | head snaps back, the body goes rigid and falls backward |
| `WalkBackward`, `CrouchWalkBackward` | ✅ | walking / crouch-walking backward, in place |
| `StrafeLeft`, `StrafeRight`, `CrouchStrafeLeft`, `CrouchStrafeRight` | ✅ | side-stepping, standing or crouched, in place |
| `TurnLeft90`, `TurnRight90`, `Turn180` | ❌ | turning on the spot with two small steps; the hips end rotated by `extras.props.turnDeg` (rotate the character by that much when the clip ends) |
| `CrossArms`, `Listen`, `HandsInPockets`, `HandsInPocketsWalk`, `LeanWall` | ✅ | idles: arms folded (Listen nods), hands in the front pockets (also walking), leaning back on a wall (`wallBehindZ`) |
| `Point`, `Shrug`, `Stretch`, `Yawn`, `CheckWatch`, `KnockDoor` | ❌ | one-off gestures (KnockDoor: a door `doorAheadZ` ahead) |
| `Clap`, `ScratchHead`, `PhoneCall`, `PhoneText`, `Read` | ✅ | looping gestures |
| `Upper_*` | per source | **upper-body layers** (Export settings → Layers): the spine and everything above it only, no hips, for Wave, Talk, Eat, Drink, Point, Shrug, Clap, CrossArms, Listen, HandsInPockets, ScratchHead, CheckWatch, Yawn, PhoneCall, PhoneText, Read, KnockDoor, CarryBag/Duffle/Box idle, CarryLantern, Rifle/Pistol aim and ready, BowShoot, CrossbowShoot, Punch. In Godot, blend one over Walk/Run with an AnimationTree filter (or a Blend2 node with the upper-body bones filtered); `extras.layer` is `"upper"` |
| `GetUpFromBack` | ❌ | from lying on the back (where `DeathBackward` / `DeathHeadshot` end): sit up on the hands, tuck the feet, squat, stand. Blend a face-up ragdoll into it |
| `GetUpFromFront` | ❌ | from lying face down (where `DeathForward` ends): push up to hands and knees, kneel, one foot forward, stand |
| `HitHeadFront/Back`, `HitTorsoFront/Back`, `HitArmLeft/Right`, `HitLegLeft/Right` | ❌ | 0.75 s jolts from the side that was hit, starting and ending exactly at `Idle`, so they can interrupt anything (play as a one-shot, or as an additive) |
| `SweepOar`, `SweepOarHold` | ✅ | steering a raft with a long sweep oar: facing the crutch, both hands overhand on the handle, walking it left and right (Hold: small corrections) |
| `PoleRaft` | ✅ | poling on the right of the deck: plant forward to the bed, push back hand under hand, lift, swing forward. In place: the bed point slides back under the character |
| `DropAnchor` | ❌ | an anchor stone held in both hands: dip, swing, throw forward over the side; release at `releaseTime` |
| `RaiseAnchor` | ✅ | hauling the anchor rope up hand over hand, rope coming up over the edge in front |
| `ClimbOutOfWater` | ❌ | treading water at a deck edge → hands on deck, press up, knee up, stand. Origin = the feet at the start; ends standing `travel` away, on the deck |
| `CarryLantern`, `CarryLanternWalk` | ✅ | a lantern held up by its bail in the left hand, out in front at shoulder height (also an upper-body layer) |
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

## Auto-rigged imports (🦴 Rig my model)

An imported GLB rigged in the app follows the same contract as a generated character: the same 25
bones, names, identity rest rotations, sockets and clips. Differences:

- Geometry is baked into world space (a skinned mesh's own node transform is ignored by the glTF
  spec), scaled to the chosen height, turned to face +Z, centred, feet on y = 0.
- Materials, textures, images, samplers and morph targets are carried over unchanged. Any skin or
  animations the file already had are replaced.
- `ThumbProximal` exists but owns no vertices (the hand bone takes the whole hand).
- The bind pose is the model's own pose (`RestPose` shows it). Every other clip is **retargeted**:
  legs are straightened under the hips and arms aligned to the shoulder line before the motion is
  applied, so a model built in an A-pose stance with its feet apart doesn't waddle. Hips rise a
  little to keep the straightened feet on the floor; hip joints sit where the thighs start.
- `scenes[0].extras.badcharacters.source` is `"auto-rigged import"` and `markers` holds the joint
  markers used, so a rig can be reproduced.

## Weapons (BadGun)

A recipe can carry `weapon: { archetype, style, seed, embed }`, a procedural weapon from
[BadGun](https://github.com/badsadcode/BadGun) (vendored as a git submodule in `vendor/BadGun`).
The weapon's own sockets drive the character:

| BadGun socket | Used for |
|---|---|
| `SOCKET_Hand_Grip` (origin) | trigger hand: lands on `Socket_RightHand_Weapon` |
| `SOCKET_Hand_Support` | support hand (palm), by two-bone IK every frame; on long guns it slides back along the handguard if the arm can't reach |
| `SOCKET_Shoulder` | stock butt, placed in the right shoulder pocket |

Clips fitted to that exact weapon (both hands on it, every frame):

| Weapon | Clips |
|---|---|
| rifle, SMG, shotgun, sniper, LMG, crossbow | `RifleAim` (shouldered, bladed stance, cheek down), `RifleReady` (low ready), `RifleReadyWalk`, `RifleRun` (low ready), `RifleSprint` (high port across the chest), `RifleCrawl` (prone, gun ahead of the face), `RifleCrouchReady`, `RifleCrouchAim`, `RifleCrouchWalk`, `RifleCrouchWalkAim` (crouched; the gun stays level while the body leans) (RifleAim / RifleReady replace the generic ones) |
| pistol | `PistolAim` (two-handed, arms out), `PistolReady` (low and close), `PistolReadyWalk`, `PistolRun`, `PistolSprint` (one-handed, gun tucked muzzle-down, the free arm pumps), `PistolCrouchReady`, `PistolCrouchAim`, `PistolCrouchWalk`, `PistolCrouchWalkAim` |

With `embed: true` the weapon GLB is merged into the character's: a node `Weapon_<name>` under the
`RightHand` bone (a rigid attachment, no skinning), its materials untouched, and its own clips
(Fire, Reload, Cycle…) as `Weapon_Fire`, `Weapon_Reload`… which animate only the gun's parts, so
play them on top of the character's clip. Without `embed`, attach your own copy of the weapon to
`Socket_RightHand_Weapon`; the fitted clips are exported either way.
`scenes[0].extras.badcharacters.weapon` records the BadGun recipe and a playground link.

## Clip props

Clips that assume furniture or objects write their measurements (metres, character space: origin
on the floor between the feet, +Z forward) into the animation's `extras.props`, so you can place the
chair, table, door, wheel or saddle without guessing:

| Clip | `extras.props` |
|---|---|
| `SitDown`, `StandUp`, `SitIdle` | `seatHeight`, `seatCentreZ` (negative: behind the origin), `feetAt` |
| `SitEat`, `SitDrink`, `SitType` | the above + `tableHeight`, `tableEdgeZ`, and `bowlZ` / `cupZ` / `keyboardZ` |
| `OpenDoor`, `CloseDoor` | `hinge` [x, y, z], `handleFromHinge`, `handleHeight`, `openDeg`, `pushStart`/`pushEnd` (s), `pullStart`/`pullEnd` (s) |
| `DriveCar` | `wheelCentreAboveHips`, `wheelAheadOfChest`, `wheelRadius`, `wheelTiltDeg`, `seatedHipsAboveFloor` |
| `Ride*` | `hipsAboveSaddleSeat`, `originBelowSaddleSeat`, `barrelWidth` |
| `SitGround`, `Sleep` | `seatHeight: 0` / `hipsAboveFloor` |
| `TurnLeft90`, `TurnRight90`, `Turn180` | `turnDeg` |
| `SweepOar*` | `handle`, `pivot` (the crutch) [x, y, z], `slope` (rad, handle above pivot), `sweepDeg` |
| `PoleRaft` | `poleSide`, `poleX`, `bedDepthBelowDeck`, `poleLength` |
| `DropAnchor` | `releaseTime` (s), `releaseAt` [x, y, z], `throwVelocity` [x, y, z] m/s |
| `RaiseAnchor` | `ropeFrom` [x, y, z] (where the rope comes up), `ropeEdgeAhead` |
| `ClimbOutOfWater` | `deckAbove` (deck top above the start origin), `edgeAhead` (deck edge, +Z) |
| `CarryLantern*` | `lanternDrop`, `hand`, `hangs`: hang the lantern under `Socket_LeftHand_Tool` |
| `Death*` | `endsLying` (front / back / side), `bodyThickness`: hand over to a ragdoll at the end, or leave the body |
