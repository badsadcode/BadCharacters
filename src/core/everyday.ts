/**
 * Everyday life: sitting down on a chair, sitting, standing up, eating and drinking (at a table
 * and standing), typing at a desk, sitting cross-legged on the floor, sleeping, and talking.
 *
 * Chair clips keep the feet where the character stood: the seat is BEHIND the origin, centred
 * under the seated Hips. Every clip's props (seat height, table height…) are in `info`, which the
 * exporter writes into the animation's extras, so furniture can be placed without guessing.
 */
import { add, DEG, lerp, norm, qChain, qMul, Quat, qx, qy, qz, QI, V3 } from './math';
import { Clip, Pose, worldPose } from './anim';
import type { Grip, Kit } from './actions';

const TAU = Math.PI * 2;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const key = (times: number[], vals: number[], t: number) => {
  if (t <= times[0]) return vals[0];
  for (let i = 0; i < times.length - 1; i++) if (t <= times[i + 1]) return lerp(vals[i], vals[i + 1], ease((t - times[i]) / (times[i + 1] - times[i])));
  return vals[vals.length - 1];
};
const mix = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

export function everydayClips(kit: Kit): Clip[] {
  const { sk, clips, grips, seatLegs, restHipY } = kit;
  const d = sk.dims;
  const u = d.u;
  const H = d.H;
  const thighLen = d.hipY - d.kneeY;
  const shinLen = d.kneeY - d.ankleY;
  const idle = clips.find((c) => c.name === 'Idle')!;
  const out: Clip[] = [];

  // ───────────────────────────────────────────────────────── chair
  const SEAT_TH = 86;
  const SEAT_KN = 90;
  /** legs from standing (k = 0) to seated (k = 1) with the feet planted where they stood */
  const sitLegs = (k: number) => {
    const th = lerp(2, SEAT_TH, k);
    const kn = lerp(3, SEAT_KN, k);
    const hy = d.ankleY + thighLen * Math.cos(th * DEG) + shinLen * Math.cos((kn - th) * DEG);
    const hz = -(thighLen * Math.sin(th * DEG) - shinLen * Math.sin((kn - th) * DEG));
    return { th, kn, hips: [0, hy - restHipY, hz] as V3 };
  };
  const seated = sitLegs(1);
  const seatTop = restHipY + seated.hips[1] - 0.6 * d.hipHD;
  const tableTop = seatTop + 0.3 * u;
  const chairInfo = { seatHeight: seatTop, seatCentreZ: seated.hips[2], feetAt: 'origin' };
  const tableInfo = { ...chairInfo, tableHeight: tableTop, tableEdgeZ: seated.hips[2] + thighLen * 0.75 };

  /** a seated pose at blend k, with idle breathing, forward lean and the chest frame for grips */
  const sitPose = (t: number, k: number, lean = 0) => {
    const b = idle.sample(t % idle.duration);
    const rot: Record<string, Quat> = { ...b.rot };
    const L = sitLegs(k);
    seatLegs(rot, L.th, L.kn, 7 * k);
    rot.Spine = qMul(qx(lean * 0.55 * DEG), rot.Spine ?? QI);
    rot.Chest = qMul(qx(lean * 0.3 * DEG), rot.Chest ?? QI);
    rot.Head = qMul(qx(-lean * 0.5 * DEG), rot.Head ?? QI);
    const pose: Pose = { rot, hips: [L.hips[0], L.hips[1] + b.hips[1] * (1 - k), L.hips[2]] };
    return { rot, pose };
  };
  /** palms resting on the thighs, toward the knees (world) */
  const onThighs = (pose: Pose): Grip[] => {
    const wp = worldPose(sk, pose);
    return ([1, -1] as const).map((s) => {
      const S = s > 0 ? 'Left' : 'Right';
      const hip = wp.pos[sk.index[`${S}UpperLeg`]];
      const knee = wp.pos[sk.index[`${S}LowerLeg`]];
      const at = add(mix(hip, knee, 0.62), [s * 0.01 * u, d.thighR * 1.05, 0]);
      return { side: s, at, world: true, axis: norm([-s * 0.4, 0.15, 0.9]), fingers: norm([s * 0.2, -1, 0.4]) } as Grip;
    });
  };
  /** hands hanging by the sides (world), for blending into a standing pose */
  const hanging = (pose: Pose): Grip[] => {
    const wp = worldPose(sk, pose);
    return ([1, -1] as const).map((s) => {
      const S = s > 0 ? 'Left' : 'Right';
      const sh = wp.pos[sk.index[`${S}UpperArm`]];
      return { side: s, at: [sh[0] + s * 0.03 * u, sh[1] - (d.upperArmLen + d.foreArmLen) * 0.95 - d.handLen * 0.35, sh[2] + 0.02 * u], world: true, axis: [0, 0, 1], fingers: [0, -1, 0] } as Grip;
    });
  };
  const blendGrips = (a: Grip[], b: Grip[], k: number): Grip[] => a.map((g, i) => ({ ...g, at: mix(g.at, b[i].at, k), axis: mix(g.axis, b[i].axis, k), fingers: mix(g.fingers, b[i].fingers, k) }));

  const sitT = 1.6;
  const sitDown = (t: number): Pose => {
    const k = key([0, 0.25, 1.25, sitT], [0, 0.05, 1, 1], t);
    // lean forward to keep the weight over the feet while the hips travel back
    const lean = 34 * Math.sin(Math.PI * Math.min(1, k * 1.1));
    const { rot, pose } = sitPose(t, k, lean);
    const reach = key([0, 0.4, 1.1, sitT], [0, 0.3, 1, 1], t);
    grips(pose, rot, blendGrips(hanging(pose), onThighs(pose), reach));
    return pose;
  };
  out.push({ name: 'SitDown', duration: sitT, loop: false, sample: sitDown, info: chairInfo });
  out.push({ name: 'StandUp', duration: sitT, loop: false, sample: (t) => sitDown(sitT - t), info: chairInfo });
  out.push({
    name: 'SitIdle',
    duration: 4,
    loop: true,
    info: chairInfo,
    sample: (t) => {
      const { rot, pose } = sitPose(t, 1, 3 + 1.5 * Math.sin((t / 4) * TAU));
      rot.Head = qMul(qy(8 * Math.sin((t / 4) * TAU * 0.5) * DEG), rot.Head ?? QI);
      grips(pose, rot, onThighs(pose));
      return pose;
    },
  });

  /** mouth position in front of the face (world) */
  const mouth = (pose: Pose): V3 => {
    const wp = worldPose(sk, pose);
    const h = wp.pos[sk.index.Head];
    const r = wp.rot[sk.index.Head];
    const f = qMulV(r, [0, (d.chinY + 0.22 * d.headH) - sk.bones[sk.index.Head].world[1], d.headHD * 1.15]);
    return add(h, f);
  };
  /** a hand bringing food (spoon, fork, apple) or a cup from `from` to the mouth (world) */
  const toMouth = (pose: Pose, from: V3, k: number, cup: number): Grip => {
    const m = mouth(pose);
    const at = mix(from, add(m, [-0.02 * u, -0.05 * u * (1 - cup), 0.04 * u + 0.02 * u * cup]), k);
    // spoon: tip toward the bowl, then toward the mouth; cup: upright, then tipped toward the face
    const axis: V3 = cup ? norm(mix([0, 1, 0.05], [0, 0.55, -0.8], k * cup)) : norm(mix([0.25, -0.5, 0.8], [0.45, 0.2, -0.85], k));
    return { side: -1, at, world: true, axis, fingers: cup ? [1, 0, 0] : [0.3, -1, 0] };
  };
  /** the free hand resting on the table (world) */
  const onTable = (pose: Pose, s: 1 | -1, x: number, z: number): Grip => {
    const hz = pose.hips[2];
    return { side: s, at: [s * x * u, tableTop + 0.012 * u, hz + z * u], world: true, axis: [-s * 0.6, 0, 0.8], fingers: [0, -1, 0.1] };
  };

  out.push({
    name: 'SitEat',
    duration: 2.6,
    loop: true,
    info: { ...tableInfo, bowlZ: seated.hips[2] + 0.42 * u },
    sample: (t) => {
      const k = key([0, 0.5, 1.2, 1.5, 2.2, 2.6], [0, 0, 1, 1, 0, 0], t);
      const { rot, pose } = sitPose(t, 1, 14 - 6 * k);
      rot.Head = qMul(qx((10 - 14 * k) * DEG), rot.Head ?? QI);
      const bowl: V3 = [-0.02 * u, tableTop + 0.06 * u, pose.hips[2] + 0.42 * u];
      // a little scooping circle in the bowl before each lift
      const sc = (1 - k) * 0.03 * u;
      const from: V3 = [bowl[0] + sc * Math.cos(t * 5), bowl[1], bowl[2] + sc * Math.sin(t * 5)];
      grips(pose, rot, [toMouth(pose, from, k, 0), onTable(pose, 1, 0.12, 0.4)]);
      return pose;
    },
  });
  out.push({
    name: 'SitDrink',
    duration: 3,
    loop: true,
    info: { ...tableInfo, cupZ: seated.hips[2] + 0.36 * u },
    sample: (t) => {
      const k = key([0, 0.6, 1.2, 1.9, 2.5, 3], [0, 0, 1, 1, 0, 0], t);
      const sip = key([0, 1.2, 1.5, 1.7, 1.9, 3], [0, 0, 1, 1, 0, 0], t);
      const { rot, pose } = sitPose(t, 1, 8 - 6 * k);
      rot.Head = qMul(qx((4 - 10 * sip) * DEG), rot.Head ?? QI);
      const cup: V3 = [-0.12 * u, tableTop + 0.05 * u, pose.hips[2] + 0.36 * u];
      grips(pose, rot, [toMouth(pose, cup, k, 0.2 + 0.8 * sip), onTable(pose, 1, 0.14, 0.32)]);
      return pose;
    },
  });
  out.push({
    name: 'SitType',
    duration: 2,
    loop: true,
    info: { ...tableInfo, keyboardZ: seated.hips[2] + 0.38 * u },
    sample: (t) => {
      const { rot, pose } = sitPose(t, 1, 12);
      rot.Head = qMul(qx(-4 * DEG), rot.Head ?? QI);
      const key2 = (s: number) => {
        const tap = Math.max(0, Math.sin(t * TAU * (s > 0 ? 3.1 : 3.7) + s)) ** 4;
        return { side: s, at: [s * 0.1 * u, tableTop + 0.035 * u + 0.012 * u * tap, pose.hips[2] + 0.38 * u], world: true, axis: [-s * 0.7, 0, 0.7], fingers: [0, -0.5, 1] } as Grip;
      };
      grips(pose, rot, [key2(1 as const), key2(-1 as const)]);
      return pose;
    },
  });

  // ───────────────────────────────────────────────────────── standing
  out.push({
    name: 'Eat',
    duration: 3,
    loop: true,
    sample: (t) => {
      const k = key([0, 0.7, 1.3, 1.9, 2.5, 3], [0, 0, 1, 1, 0, 0], t);
      const b = idle.sample(t % idle.duration);
      const rot: Record<string, Quat> = { ...b.rot };
      rot.Head = qMul(qx((6 - 8 * k) * DEG), rot.Head ?? QI);
      const pose: Pose = { ...b, rot };
      const wp = worldPose(sk, pose);
      const sh = wp.pos[sk.index.RightUpperArm];
      const low: V3 = [sh[0] + 0.06 * u, sh[1] - 0.3 * u, sh[2] + 0.22 * u];
      // chewing between bites
      const chew = (1 - k) * Math.max(0, Math.sin(t * 14)) * 3;
      rot.Head = qMul(qx(chew * DEG), rot.Head);
      grips(pose, rot, [toMouth(pose, low, k, 0)]);
      return pose;
    },
  });
  out.push({
    name: 'Drink',
    duration: 3.2,
    loop: true,
    sample: (t) => {
      const k = key([0, 0.6, 1.1, 2.1, 2.6, 3.2], [0, 0, 1, 1, 0, 0], t);
      const tip = key([0, 1.1, 1.4, 1.9, 2.1, 3.2], [0, 0, 1, 1, 0, 0], t);
      const b = idle.sample(t % idle.duration);
      const rot: Record<string, Quat> = { ...b.rot };
      rot.Neck = qMul(qx(-14 * tip * DEG), rot.Neck ?? QI);
      rot.Head = qMul(qx(-16 * tip * DEG), rot.Head ?? QI);
      rot.Spine = qMul(qx(-3 * tip * DEG), rot.Spine ?? QI);
      const pose: Pose = { ...b, rot };
      const wp = worldPose(sk, pose);
      const sh = wp.pos[sk.index.RightUpperArm];
      const low: V3 = [sh[0] + 0.04 * u, sh[1] - 0.34 * u, sh[2] + 0.12 * u];
      grips(pose, rot, [toMouth(pose, low, k, 0.2 + 0.8 * tip)]);
      return pose;
    },
  });
  out.push({
    name: 'Talk',
    duration: 3.6,
    loop: true,
    sample: (t) => {
      const ph = (t / 3.6) * TAU;
      const b = idle.sample(t % idle.duration);
      const rot: Record<string, Quat> = { ...b.rot };
      rot.Head = qMul(qChain(qx((3 * Math.sin(ph * 4)) * DEG), qy(10 * Math.sin(ph) * DEG)), rot.Head ?? QI);
      rot.Chest = qMul(qy(4 * Math.sin(ph) * DEG), rot.Chest ?? QI);
      const pose: Pose = { ...b, rot };
      const wp = worldPose(sk, pose);
      const ucP = wp.pos[sk.index.UpperChest];
      const g = (s: 1 | -1, p: number): Grip => {
        const a = Math.max(0, Math.sin(ph * 2 + p));
        const open = Math.sin(ph * 3 + p);
        return { side: s, at: [ucP[0] + s * (0.14 + 0.06 * open) * u, ucP[1] - (0.3 - 0.14 * a) * u, ucP[2] + (0.18 + 0.1 * a) * u], world: true, axis: [-s * 0.2, 0.9, 0.3], fingers: [s * 0.4 * open, -0.2, 1] };
      };
      grips(pose, rot, [g(1, 0), g(-1, 2.2)]);
      return pose;
    },
  });

  // ───────────────────────────────────────────────────────── floor
  const groundHips = d.hipHD * 0.85;
  out.push({
    name: 'SitGround',
    duration: 4,
    loop: true,
    info: { seatHeight: 0 },
    sample: (t) => {
      const b = idle.sample(t % idle.duration);
      const rot: Record<string, Quat> = { ...b.rot };
      // cross-legged: thighs out and turned out, knees deeply bent, shins crossing in front
      // (roll each thigh about its own axis first, so the knee hinge stands upright and the shin
      // folds across in front along the floor instead of down into it)
      for (const s of [1, -1]) {
        const S = s > 0 ? 'Left' : 'Right';
        rot[`${S}UpperLeg`] = qChain(qy(s * 40 * DEG), qx(-85 * DEG), qy(s * 80 * DEG));
        rot[`${S}LowerLeg`] = qx((s > 0 ? 130 : 123) * DEG);
        rot[`${S}Foot`] = qx(-15 * DEG);
      }
      rot.Spine = qMul(qx(8 * DEG), rot.Spine ?? QI);
      rot.Head = qMul(qx(-6 * DEG), rot.Head ?? QI);
      const pose: Pose = { rot, hips: [0, groundHips - restHipY, 0] };
      const wp = worldPose(sk, pose);
      grips(
        pose,
        rot,
        ([1, -1] as const).map((s) => {
          const knee = wp.pos[sk.index[s > 0 ? 'LeftLowerLeg' : 'RightLowerLeg']];
          return { side: s, at: add(knee, [0, d.kneeR * 1.2, 0]), world: true, axis: [-s * 0.3, 0.2, 0.9], fingers: [0, -1, 0.3] } as Grip;
        }),
      );
      return pose;
    },
  });
  out.push({
    name: 'Sleep',
    duration: 5,
    loop: true,
    info: { lyingOnBack: 'head toward -Z', hipsAboveFloor: d.hipHD },
    sample: (t) => {
      const br = Math.sin((t / 5) * TAU);
      const rot: Record<string, Quat> = {};
      rot.Hips = qx(-88 * DEG);
      rot.Chest = qx(-1.5 * br * DEG);
      rot.UpperChest = qx(-1 * br * DEG);
      rot.Neck = qx(12 * DEG);
      rot.Head = qChain(qx(6 * DEG), qy(14 * DEG));
      for (const s of [1, -1]) {
        const S = s > 0 ? 'Left' : 'Right';
        rot[`${S}UpperLeg`] = qChain(qz(s * 5 * DEG), qx(-4 * DEG));
        rot[`${S}LowerLeg`] = qx(8 * DEG);
        rot[`${S}Foot`] = qx(-60 * DEG);
      }
      const pose: Pose = { rot, hips: [0, d.hipHD - restHipY, 0] };
      const wp = worldPose(sk, pose);
      // arms resting on the floor by the sides, palms down
      grips(
        pose,
        rot,
        ([1, -1] as const).map((s) => {
          const hip = wp.pos[sk.index[s > 0 ? 'LeftUpperLeg' : 'RightUpperLeg']];
          return { side: s, at: [hip[0] + s * 0.12 * u, d.handHT * 0.6, hip[2] + 0.05 * u], world: true, axis: [s * 0.2, 0, 1], fingers: [0, -1, 0] } as Grip;
        }),
        );
      return pose;
    },
  });
  // ───────────────────────────────────────────────────────── gestures & idles
  /** a standing clip: idle (or another base) breathing, plus per-frame body tweaks and hand grips (chest frame) */
  const gesture = (name: string, T: number, loop: boolean, hands: (t: number, rot: Record<string, Quat>, pose: Pose) => Grip[], o: { base?: string; info?: Clip['info'] } = {}): Clip => {
    const base = clips.find((c) => c.name === (o.base ?? 'Idle'))!;
    return {
      name,
      duration: T,
      loop,
      ...(o.info ? { info: o.info } : {}),
      sample: (t) => {
        const b = base.sample(t % base.duration);
        const rot: Record<string, Quat> = { ...b.rot };
        const pose: Pose = { ...b, rot };
        const g = hands(t, rot, pose);
        if (g.length) grips(pose, rot, g);
        return pose;
      },
    };
  };
  const C = (x: number, y: number, z: number): V3 => [x * u, y * u, d.chestHD + z * u];
  const wave = (t: number, T: number, k = 1) => Math.sin((t / T) * TAU * k);
  /** a fist / relaxed hand: thumb up, fingers forward (chest frame) */
  const relaxed = (s: 1 | -1, at: V3, fingers: V3 = [0, -0.3, 1]): Grip => ({ side: s, at, axis: [-s * 0.3, 0.9, 0.2], fingers });

  // arms folded across the chest; the right forearm on top
  const folded = (): Grip[] => [
    { side: 1, at: C(-0.11, -0.16, 0.03), axis: [-0.2, 0.3, 0.9], fingers: [-0.8, 0, -0.4] },
    { side: -1, at: C(0.11, -0.13, 0.07), axis: [0.2, 0.3, 0.9], fingers: [0.8, 0, -0.4] },
  ];
  out.push(gesture('CrossArms', 4, true, (t, rot) => {
    rot.Head = qMul(qy(6 * wave(t, 4) * DEG), rot.Head ?? QI);
    return folded();
  }));
  out.push(gesture('Listen', 3, true, (t, rot) => {
    rot.Head = qMul(qChain(qx(7 * Math.max(0, wave(t, 3, 2)) * DEG), qz(5 * DEG)), rot.Head ?? QI);
    return folded();
  }));
  // hands in the front pockets (world: at the hip joints)
  const pockets = (pose: Pose): Grip[] => {
    const wp = worldPose(sk, pose);
    return ([1, -1] as const).map((s) => {
      const hip = wp.pos[sk.index[s > 0 ? 'LeftUpperLeg' : 'RightUpperLeg']];
      return { side: s, at: [hip[0] + s * 0.035 * u, hip[1] - 0.07 * u, hip[2] + d.hipHD * 0.75], world: true, axis: [0, -0.2, 1], fingers: [-s * 0.2, -1, 0.2] } as Grip;
    });
  };
  out.push(gesture('HandsInPockets', 4, true, (_t, _rot, pose) => pockets(pose)));
  out.push(gesture('HandsInPocketsWalk', clips.find((c) => c.name === 'Walk')!.duration, true, (_t, rot, pose) => {
    rot.Spine = qMul(qx(4 * DEG), rot.Spine ?? QI);
    return pockets(pose);
  }, { base: 'Walk' }));
  // leaning back against a wall, arms folded, one foot crossed over the other
  out.push(gesture('LeanWall', 4, true, (t, rot, pose) => {
    rot.Hips = qMul(qx(-7 * DEG), rot.Hips ?? QI);
    rot.Spine = qMul(qx(-4 * DEG), rot.Spine ?? QI);
    rot.LeftUpperLeg = qChain(qz(-8 * DEG), qx(-4 * DEG));
    rot.LeftLowerLeg = qx(10 * DEG);
    rot.LeftFoot = qx(-20 * DEG);
    rot.Head = qMul(qy(10 * wave(t, 4) * DEG), rot.Head ?? QI);
    pose.hips = [0, pose.hips[1] - 0.01 * u, -0.06 * u];
    return folded();
  }, { info: { wallBehindZ: -(d.chestHD + 0.12 * u) } }));
  // pointing ahead and up a little, then lowering the arm
  out.push(gesture('Point', 1.8, false, (t, rot) => {
    const k = Math.sin(Math.PI * Math.min(1, t / 1.8)) ** 0.5;
    rot.Head = qMul(qy(-8 * k * DEG), rot.Head ?? QI);
    return [{ side: -1, at: C(lerp(-0.1, -0.15, k), lerp(-0.45, 0.08, k), lerp(-0.1, 0.55, k)), axis: [0.1, 0.9, 0.2], fingers: [0, lerp(-1, 0.05, k), lerp(0, 1, k)] }];
  }));
  // shrug: shoulders up, palms up and out
  out.push(gesture('Shrug', 1.5, false, (t, rot) => {
    const k = Math.sin(Math.PI * Math.min(1, t / 1.5));
    for (const s of [1, -1]) rot[s > 0 ? 'LeftShoulder' : 'RightShoulder'] = qz(s * 12 * k * DEG);
    rot.Head = qMul(qz(8 * k * DEG), rot.Head ?? QI);
    return ([1, -1] as const).map((s) => ({ side: s, at: C(s * lerp(0.12, 0.27, k), lerp(-0.42, -0.24, k), lerp(-0.05, 0.12, k)), axis: [s * 0.2, 0.1, 1], fingers: [s * 0.9, 0.4 * k, 0.3] }));
  }));
  out.push(gesture('Clap', 0.55, true, (t) => {
    const open = 0.5 + 0.5 * Math.cos((t / 0.55) * TAU);
    return ([1, -1] as const).map((s) => ({ side: s, at: C(s * (0.015 + 0.08 * open), -0.1, 0.2), axis: [0, 0.95, 0.3], fingers: [-s * 0.4, 0.2, 1] }));
  }));
  // stretch: arms up overhead, a lean back, back down
  out.push(gesture('Stretch', 3, false, (t, rot) => {
    const k = Math.sin(Math.PI * Math.min(1, t / 3)) ** 0.6;
    rot.Spine = qMul(qx(-8 * k * DEG), rot.Spine ?? QI);
    rot.Head = qMul(qx(-12 * k * DEG), rot.Head ?? QI);
    return ([1, -1] as const).map((s) => ({ side: s, at: C(s * lerp(0.2, 0.12, k), lerp(-0.45, 0.62, k), lerp(-0.1, -0.05, k)), axis: [-s * 0.3, 0.2, 0.9], fingers: [0, lerp(-1, 1, k), 0.1] }));
  }));
  // yawn: the hand comes up to the mouth, the head tips back
  out.push(gesture('Yawn', 2.6, false, (t, rot, pose) => {
    const k = Math.sin(Math.PI * Math.min(1, t / 2.6)) ** 0.7;
    rot.Neck = qMul(qx(-10 * k * DEG), rot.Neck ?? QI);
    rot.Head = qMul(qx(-14 * k * DEG), rot.Head ?? QI);
    const m = mouth(pose);
    const wp = worldPose(sk, pose);
    const sh = wp.pos[sk.index.RightUpperArm];
    const from: V3 = [sh[0] + 0.03 * u, sh[1] - 0.42 * u, sh[2] + 0.05 * u];
    return [{ side: -1, at: mix(from, [m[0], m[1], m[2] + 0.03 * u], k), world: true, axis: [0.9, 0.1, 0.1], fingers: mix([0, -1, 0], [0, 0.2, -1], k) }];
  }));
  // scratching the back of the head
  out.push(gesture('ScratchHead', 2, true, (t, rot, pose) => {
    const wp = worldPose(sk, pose);
    const head = wp.pos[sk.index.Head];
    rot.Head = qMul(qChain(qz(-8 * DEG), qx(6 * DEG)), rot.Head ?? QI);
    const sc = 0.012 * u * Math.sin(t * 22);
    return [{ side: -1, at: [head[0] - d.headHW * 0.75, head[1] + d.headH * 0.45 + sc, head[2] - d.headHD * 0.1], world: true, axis: [0, 0.2, 1], fingers: [0.6, 0.7, 0] }];
  }));
  // checking a wristwatch on the left wrist
  out.push(gesture('CheckWatch', 2.2, false, (t, rot) => {
    const k = Math.sin(Math.PI * Math.min(1, t / 2.2)) ** 0.5;
    rot.Head = qMul(qChain(qx(18 * k * DEG), qy(10 * k * DEG)), rot.Head ?? QI);
    return [{ side: 1, at: C(lerp(0.18, 0.06, k), lerp(-0.45, -0.12, k), lerp(-0.05, 0.22, k)), axis: [-1, 0.2, 0.3], fingers: [0, lerp(-1, -0.2, k), lerp(0, 1, k)] }];
  }));
  // knocking on a door ahead: three raps
  out.push(gesture('KnockDoor', 1.6, false, (t, rot) => {
    const reach = Math.min(1, t / 0.35) * Math.min(1, (1.6 - t) / 0.35);
    const rap = Math.max(0, Math.sin(Math.max(0, t - 0.35) * Math.PI * 2 * 2.6)) * (t > 0.35 && t < 1.25 ? 1 : 0);
    rot.Head = qMul(qx(-4 * DEG), rot.Head ?? QI);
    return [{ side: -1, at: C(-0.05, lerp(-0.45, 0.12, reach), lerp(-0.1, 0.36 - 0.05 * rap, reach)), axis: [0.4, 0.9, 0], fingers: [0.3, 0, 1] }];
  }, { info: { doorAheadZ: d.chestHD + 0.42 * u } }));
  // phone: at the ear (call) or held in front, thumbs typing (text)
  out.push(gesture('PhoneCall', 4, true, (t, rot, pose) => {
    rot.Head = qMul(qChain(qz(-7 * DEG), qy(8 * wave(t, 4) * DEG)), rot.Head ?? QI);
    const wp = worldPose(sk, pose);
    const head = wp.pos[sk.index.Head];
    const free = 0.5 + 0.5 * wave(t, 4, 2);
    return [
      { side: -1, at: [head[0] - d.headHW * 1.05, head[1] + d.headH * 0.3, head[2] + d.headHD * 0.25], world: true, axis: [0.1, 0.95, 0.2], fingers: [0.9, 0, 0.3] },
      relaxed(1, C(0.18, lerp(-0.4, -0.22, free), lerp(-0.02, 0.14, free))),
    ];
  }));
  out.push(gesture('PhoneText', 2, true, (t, rot) => {
    rot.Head = qMul(qx(24 * DEG), rot.Head ?? QI);
    rot.Neck = qMul(qx(10 * DEG), rot.Neck ?? QI);
    const tap = (s: number) => 0.008 * u * Math.max(0, Math.sin(t * TAU * (s > 0 ? 3.3 : 2.9) + s));
    return ([1, -1] as const).map((s) => ({ side: s, at: [s * 0.035 * u, -0.22 * u + tap(s), d.chestHD + 0.2 * u], axis: [-s * 0.3, 0.6, 0.7], fingers: [-s, 0, 0] }));
  }));
  // reading a book held in both hands
  out.push(gesture('Read', 5, true, (t, rot) => {
    rot.Head = qMul(qChain(qx(20 * DEG), qy(5 * wave(t, 5) * DEG)), rot.Head ?? QI);
    return ([1, -1] as const).map((s) => ({ side: s, at: C(s * 0.09, -0.18, 0.24), axis: [0, 0.85, 0.5], fingers: [-s * 0.8, 0, 0.6] }));
  }));
  void H;
  return out;
}

/** rotate a vector by a quaternion */
function qMulV(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const t: V3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}
