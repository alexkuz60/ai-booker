/**
 * Tests for VocoLoco WAV encoder header layout.
 */
import { describe, it, expect } from "vitest";
import { encodeFloat32ToWav } from "../vocoloco/wavEncoder";

describe("encodeFloat32ToWav", () => {
  it("writes a valid 16-bit PCM mono header at given sample rate", async () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeFloat32ToWav(pcm, 24000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);

    // RIFF / WAVE / fmt  / data magic
    const tag = (off: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, off, len));
    expect(tag(0, 4)).toBe("RIFF");
    expect(tag(8, 4)).toBe("WAVE");
    expect(tag(12, 4)).toBe("fmt ");
    expect(tag(36, 4)).toBe("data");

    // fmt chunk
    expect(view.getUint16(20, true)).toBe(1);     // PCM
    expect(view.getUint16(22, true)).toBe(1);     // mono
    expect(view.getUint32(24, true)).toBe(24000); // sample rate
    expect(view.getUint16(34, true)).toBe(16);    // bits per sample

    // data size = N * 2 bytes (16-bit mono)
    expect(view.getUint32(40, true)).toBe(pcm.length * 2);
  });

  it("clamps Float32 samples into the int16 range", async () => {
    const pcm = new Float32Array([2, -2, 1, -1]);
    const blob = encodeFloat32ToWav(pcm, 16000);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    // First sample should clamp to +full-scale (0x7fff)
    expect(view.getInt16(44, true)).toBe(0x7fff);
    // Second sample should clamp to -full-scale (-0x8000)
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
