// Lofi background music tracks. The placeholder .wav files are soft generated
// pads so the feature works out of the box — replace them with real lofi
// tracks of the same filenames whenever you like.
export type MusicTrack = {
  id: number;
  name: string;
  source: number; // result of require()
};

export const MUSIC_TRACKS: MusicTrack[] = [
  { id: 1, name: "Dusk", source: require("../assets/music/track1.wav") },
  { id: 2, name: "Rainy", source: require("../assets/music/track2.wav") },
  { id: 3, name: "Study", source: require("../assets/music/track3.wav") },
  { id: 4, name: "Mellow", source: require("../assets/music/track4.wav") },
  { id: 5, name: "Night", source: require("../assets/music/track5.wav") }
];

export function trackById(id: number): MusicTrack {
  return MUSIC_TRACKS.find(t => t.id === id) ?? MUSIC_TRACKS[0];
}
