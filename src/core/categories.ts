/**
 * Animation categories: so 100+ clips don't become 100+ buttons. Used by the studio's animation
 * browser and written into each exported animation's extras (`category`), which also helps keep
 * them organised in an engine.
 */
export interface ClipCategory {
  id: string;
  label: string;
  icon: string;
  match: RegExp;
}

/** first match wins, so the order matters */
export const CLIP_CATEGORIES: ClipCategory[] = [
  { id: 'layers', label: 'Upper-body layers', icon: '🧍', match: /^Upper_/ },
  { id: 'death', label: 'Hits & deaths', icon: '💀', match: /^(Death|Hit|GetUp)/ },
  { id: 'weapons', label: 'Weapons', icon: '🔫', match: /^(Rifle|Pistol|Bow|Crossbow)/ },
  { id: 'combat', label: 'Combat', icon: '🥊', match: /^(Punch|Kick|Sword|Staff)/ },
  { id: 'traverse', label: 'Climb & vault', icon: '🧗', match: /^(Climb|Ladder|RockClimb|Vault)/ },
  { id: 'water', label: 'Water', icon: '🌊', match: /^(Swim|Float|Dive)/ },
  { id: 'ride', label: 'Ride & drive', icon: '🐎', match: /^(Ride|Drive|PushCart)/ },
  { id: 'tools', label: 'Tools & work', icon: '🪓', match: /^(Craft|Axe|Shovel|Saw|Hammer|Weld|Fish)/ },
  { id: 'carry', label: 'Carry & doors', icon: '📦', match: /^(Carry|OpenDoor|CloseDoor)/ },
  { id: 'everyday', label: 'Everyday', icon: '☕', match: /^(Sit|Stand|Eat|Drink|Talk|Sleep|Wave|Lean|Cross|Hands|Point|Shrug|Clap|Stretch|Yawn|Scratch|Check|Knock|Phone|Read|Listen)/ },
  { id: 'move', label: 'Locomotion', icon: '🏃', match: /^(Idle|RestPose|Walk|Run|Sprint|Jump|Crouch|Slide|Crawl|Zombie|Strafe|Turn)/ },
  { id: 'gun', label: 'Gun parts', icon: '⚙️', match: /^Weapon_/ },
  { id: 'other', label: 'Other', icon: '✨', match: /./ },
];

export function clipCategory(name: string): string {
  return (CLIP_CATEGORIES.find((c) => c.match.test(name)) ?? CLIP_CATEGORIES[CLIP_CATEGORIES.length - 1]).id;
}
