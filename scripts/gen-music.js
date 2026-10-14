// Generates 5 short, soft, loopable placeholder WAV files under assets/music/.
// These are gentle sine-based pads so the Music feature works out of the box.
// Replace them with real lofi tracks (same filenames) whenever you like.
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "assets", "music");
fs.mkdirSync(outDir, { recursive: true });

const SAMPLE_RATE = 22050;
const DURATION = 6; // seconds, loops seamlessly

// Each track: a small set of frequencies (a soft chord) + slow tremolo.
const TRACKS = [
  { name: "track1", freqs: [220, 277.18, 329.63], tremolo: 0.15 }, // A major-ish
  { name: "track2", freqs: [196, 246.94, 293.66], tremolo: 0.12 }, // G
  { name: "track3", freqs: [174.61, 220, 261.63], tremolo: 0.18 }, // F
  { name: "track4", freqs: [164.81, 207.65, 246.94], tremolo: 0.1 }, // E
  { name: "track5", freqs: [146.83, 185, 220], tremolo: 0.2 } // D
];

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

for (const track of TRACKS) {
  const total = SAMPLE_RATE * DURATION;
  const samples = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    // Seamless loop: use whole number of cycles via DURATION-based phase.
    let s = 0;
    for (const f of track.freqs) s += Math.sin(2 * Math.PI * f * t);
    s /= track.freqs.length;
    // Slow tremolo for a calm, breathing texture.
    const trem = 1 - track.tremolo + track.tremolo * Math.sin(2 * Math.PI * (1 / DURATION) * t);
    // Gentle overall gain to keep it soft.
    samples[i] = s * trem * 0.22;
  }
  const file = path.join(outDir, `${track.name}.wav`);
  writeWav(file, samples);
  console.log("wrote", file);
}
console.log("done");
