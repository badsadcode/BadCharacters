# BadCharacters

**Procedural low-poly characters with knees, elbows and absolutely no hair (unless you ask nicely).**
*Bad Ideas Works: We Create Worlds. Badly. Now with people in them.*

BadCharacters generates game-ready humanoids: a skinned, rigged, animated GLB with a
Unity-Humanoid-compatible skeleton, a pixel-art face, layered clothing that bends with the body,
runtime fat/muscle morphs, and a seed-reproducible recipe.

- **App:** `npm install && npm run dev` (or the GitHub Pages deployment)
- **Devlog:** `devlog.html` on the site, a non-technical and mostly true story of how it was built
- **Rig / export contract:** [`docs/RIG.md`](docs/RIG.md)

## What you get

| | |
|---|---|
| Styles | Blocky, **Boxy** (bevelled rectangles, Noor's design), Chibi, Stylized, Faceted (flat-shaded, like the race sheets), Realistic, Heroic, Stocky, plus slimmer newer styles: **Voxel** and **Voxel Slim** (plain rectangular blocks, ~850 triangles), **Brick**, **Brick Slim** and **Capsule** (no taper: straight pillar limbs and torso), and two styles with a different *construction*: **Segments** and **Puppet** (a separate rigid block per bone, recessed hinges at every joint), **Mannequin** (wooden ball joints) and **Action Figure** (glossy, peg joints) |
| Races | Human, Orc, Elf, Dwarf, Hobbit, Goblin, Gremlin, Mutant, Stone golem, Flower golem: work with every style |
| Body sliders | height, masculine↔feminine build, muscle, fat, head size, leg length, roundness, skin, plus 21 fine sliders (shoulders, chest, waist, hips, belly, arm length/thickness, leg thickness, neck, head width/depth, jaw, hands, feet, ears, nose, eyes, mouth, posture) |
| Face | pixel-art texture: 8 eye styles (incl. zombie, third eye), 7 mouths, optional brows/blush/scars, modelled nose, race ears, tusks |
| Outfits | 14 slots, 94 garments: civilian, fantasy, WWI/WWII/Vietnam/modern/future military, survival and wasteland gear; any garment can be torn |
| Patterns | woodland, desert, tiger stripe, ERDL, flecktarn, digital, urban, splinter, snow, plaid, stripes, grime, bloodstained, patched |
| Themes | 24, from Base body and Explorer to WWI soldier, Modern soldier, Survivor, Wasteland raider, Zombie, Mutant, Hard-hat diver, Scuba diver, Deep-sea hard suit and Adventuring party |
| Opt-in extras | voxel hair, beards (the base brief is bald and clean-shaven) |
| Props | staff, bow, crossbow, rifle: **previewed in the viewer, not exported unless you tick "Props"** (bring your own weapons; the animations never need them) |
| Presets | Alden Wayfarer (Thornwake), Mannequin, Sir Clanksalot, Pip the Apprentice |
| Rig | 25 bones, Unity `HumanBodyBones` names, identity rest rotations, 10 sockets incl. oriented weapon and tool mounts (+ `BowString` helper bone when a bow is exported) |
| Animations | 119 (+ up to 6 per held weapon, + 27 optional upper-body layers), in 12 categories: walking backward, strafing, turning, gestures (cross arms, pockets, lean, point, shrug, clap, stretch, yawn, phone, read…), 6 deaths (forward, backward, left, right, crumple, headshot), sitting down / standing up, sitting, eating, drinking, typing, talking, cross-legged, sleeping, riding (idle, walk, trot, gallop), driving a car, a horse cart, pushing a handcart, punches and kicks (left/right × high/mid/low), sword, staff, axe, shovel, saw, hammer, weld, fishing, Idle, Walk, Run, Sprint, Jump, Wave, Punch, Crouch, CrouchWalk, Crawl, CrawlProne, Slide, Vault, ClimbOver, ClimbUp/Down/Left/Right, RockClimbUp/Down/Left/Right, CarryBag/Duffle/Box (Idle, Walk), OpenDoor, CloseDoor, LadderUp/Down, Swim, Float, Dive, SwimUnderwater, Craft, BowShoot, CrossbowShoot, RifleAim, RifleReady, ZombieWalk, RestPose |
| Export | GLB (validator-clean), editable `.badchar.json` recipe, share links |
| Budget | low 1.5k–2.8k · medium 1.7k–4.0k (median 2.7k) · high 2.5k–6.7k triangles; Alden is 2,880 |

## Creatures (BadCreatures)

The **🦈 Creatures** mode generates the abyss bestiary from Tom's sheets: **19 species** across four
body plans (fish, tentacled, legged, rays): megalodon, leviathan, angler, viperfish, gulper,
frilled devourer, abyssal whale, lamprey, brine worm, siphoner, kraken, deep jelly, jelly beast,
observer, abyssal crab, giant isopod, hatcher, rift ray, lantern skate.

- Rigged GLBs (front +Z, identity bone rests), 430 to 2,200 triangles, countershaded mottled skin,
  emissive glow maps, translucent jelly bells
- Clips: Swim, SwimFast, Idle, Bite (jawed) / Attack; walkers get Walk, Run, Idle, Attack
- **Solitude:** each species' motion is one list of yaw/pitch/roll channels. It bakes the clips *and*
  writes a ready-to-paste `CreatureProfile` for Solitude's Swimmer ("🐚 Solitude profile" button),
  with axes matching Swimmer 1:1
- Sliders: length, mouth gape, teeth, fins/arms, glow spots, blotches, scars, seven colours

## Factions

Pick a **faction** and every member wears only that faction's kit, in its colours, with its own roles
(rifleman, machine gunner, radio operator, officer…) each carrying a fitting BadGun weapon, and its own
spread of bodies. **🎲 New member** rolls another one, **👥 Squad** lines up six; style, race and every
slider stay yours. Factions: Viet Cong guerrillas, North Vietnamese Army, US Marines (Vietnam era),
US Marines (modern), US Army (WWII), Resistance fighters (WWII), British infantry (WWI), wasteland
raiders, orbital infantry, an order of knights and a zombie horde. Generic period kit, no insignia.

## Exporting a selection of animations

One `.glb` holds every clip you tick under **Export settings → Animations** (all by default). In
Blender (File → Import → glTF 2.0) each clip becomes an **Action**; in Godot they all land in the
AnimationPlayer. Only tick the ones your game uses and the file shrinks accordingly.

## Weapons (BadGun inside)

The **Weapon** panel puts a procedural gun from [BadGun](https://github.com/badsadcode/BadGun) in the
character's hands: pick a type (rifle, SMG, shotgun, sniper, LMG, pistol, crossbow), a style (modern,
steampunk, sci-fi, scrap, fantasy, WW1, WW2, Vietnam, diesel, cyber) and a seed. The aim and ready
clips are rebuilt for that exact weapon: the trigger hand on its grip, the support hand on its
handguard (two-bone IK, every frame), the stock in the shoulder pocket. Tick *Export* to put the gun in
the GLB on the right hand, or attach your own copy to `Socket_RightHand_Weapon`. BadGun is a git
submodule: `git submodule update --init` after cloning.

## Rig my model (bring your own GLB)

The **🦴 Rig my model** mode skins *your* humanoid model with our skeleton and animations:

1. Drop in a `.glb` standing in a T- or A-pose (any units, any facing: there's a height field and a turn option).
2. Markers are auto-placed on chin, neck, groin, shoulders, elbows, wrists, knees, ankles and balls of the feet.
   Drag them where they belong; *Mirror* moves both sides together.
3. Press ▶ or pick any clip to preview, then **📦 Export GLB**.

You get your mesh, materials, textures and shape keys untouched, plus the same 25-bone Unity-named skeleton,
sockets and all the clips as a generated character. Skin weights are automatic (distance to each bone relative
to the thickness of that body part, soft blending at joints, smoothing across the surface, UV seams welded so
nothing tears). Tests strip the skeletons off our own characters, re-rig them and check that nearly every
vertex lands on the generator's bone or its direct neighbour. Long coats, capes and tails may need touch-ups
in Blender.

## How it works (short version)

Every body part is a **loft of rounded-box cross-sections** (superellipses). One exponent slides
the whole character from "Minecraft block" to "smooth pebble". Rings carry skin weights, and
weights are blended across joints, so an elbow is one continuous surface that bends instead of
two boxes kissing.

Clothing is the same rings again, **inflated by a layer thickness**. A sleeve is literally "arm
rings from the shoulder to the elbow, plus 8 mm", so it inherits the arm's skinning and can't
tear at the joint.

**Polygon diet.** Every body part and garment remembers which rings it was cut from, so the
generator knows exactly which stretches are fully wrapped by a thicker layer (legs in trousers,
feet in boots, a shirt under a chestplate, a scalp under hair) and deletes them. Rings that are a
straight interpolation of their neighbours (within ~2 mm and 0.08 skin weight) are dropped, voxel
bits are true 12-triangle boxes with hard edges, small parts get fewer sides, and near-boxy
cross-sections get 8 sides instead of 12. Tests enforce the budget.

The viewer **renders the exported GLB**, not an in-memory approximation, so what you see is
what your engine gets.

## Commands

```bash
npm run dev                                       # the app
npm test                                          # 700+ tests: every style × theme and race validates clean, polygon budgets, hats/skirts enclose what they cover, feet on floor, animation sanity
npm run cli -- export blocky explorer 42 out/     # one character → GLB + recipe
npm run cli -- samples out/samples                # a sample per style
```

## Status (honest version)

| Area | State |
|---|---|
| Generation, styles, themes, sliders, presets | ✅ working |
| GLB export (skin, morphs, texture, clips, sockets, recipe in extras) | ✅ Khronos validator: 0 errors, 0 warnings on all 72 style×theme combos |
| Animations | ✅ procedural, checked with forward-kinematics tests and by eye |
| Godot import | ✅ confirmed by Tom: generated characters walking on Solitude's title screen (Godot 4, skinning + baked clips) |
| Unity / Unreal import | ⚠️ not yet verified inside those editors (not available in the build environment) |
| Fingers | ❌ mitten hands + thumb by design (low-poly budget) |
| Facial animation | ❌ the face is a static texture for now (blinking would be a nice next step) |
