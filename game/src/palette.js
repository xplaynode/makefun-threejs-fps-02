// palette.js -- SLAGLINE colour definitions.
// All materials derive from the table below, which is what makes the yard
// feel like a single location: rusted ironwork, grey slag, ochre safety
// paint and dark harbour teal, all under a dusky steel-blue sky.

export const PALETTE = {
  sky: 0x2e3d4d,
  fog: 0x2e3d4d,
  ground: 0x4a4238,
  groundDark: 0x3a342c,
  iron: 0x6e4a35,
  ironDark: 0x4c332a,
  concrete: 0x8a8578,
  concreteDark: 0x6b665b,
  ochre: 0xd98a2b,
  slag: 0x2f2d2b,
  teal: 0x2e6f6a,
  ember: 0xff5a26,
  breaker: 0xd98a2b,
  warden: 0x3f7fbf,
  crateWood: 0x8a6b46,
  barrel: 0x51606b,
  white: 0xe8e2d4,
};

export const TEAM = {
  breaker: { color: PALETTE.breaker, name: 'Breakers' },
  warden: { color: PALETTE.warden, name: 'Wardens' },
};
