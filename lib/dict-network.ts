// The 17 connected dots inside the yellow map of the Philippines in the DICT logo.
// Per the official logo description they stand for the 17 regions connected by
// technology. Coordinates are in the 700x700 space of /logo-core-clean.png (the
// logo art with the original white network removed), listed roughly north -> south.
export const DICT_NODES: [number, number][] = [[301.2, 184.0], [329.8, 194.0], [313.0, 245.0], [320.0, 264.0], [353.8, 274.0], [340.0, 326.0], [413.8, 332.0], [273.4, 358.9], [364.2, 375.0], [403.7, 379.0], [414.0, 442.0], [452.0, 442.0], [374.0, 469.0], [480.8, 475.0], [384.2, 493.0], [465.0, 503.0], [285.2, 547.0]];

// Links between the regions (pairs of indexes into DICT_NODES), traced from the logo.
export const DICT_EDGES: [number, number][] = [[0, 1], [0, 2], [1, 2], [1, 4], [2, 3], [2, 7], [3, 5], [3, 9], [4, 5], [4, 7], [4, 9], [5, 7], [5, 8], [6, 8], [7, 8], [7, 12], [8, 10], [8, 12], [9, 10], [9, 11], [10, 11], [10, 12], [10, 14], [10, 15], [11, 13], [11, 15], [12, 14], [12, 16], [13, 15], [14, 15], [14, 16], [6, 12]];
