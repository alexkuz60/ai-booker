/**
 * IR Peaks — utility to compute a compact waveform peaks array
 * from decoded AudioBuffer data for storage and fast rendering.
 */

/** Number of peaks to store — enough for smooth waveform at any panel width */
const DEFAULT_PEAK_COUNT = 200;

/**
 * Compute peaks from an AudioBuffer.
 * Returns an array of absolute peak values (0..1), length = peakCount.
 */
export function computePeaks(
  buffer: AudioBuffer,
  peakCount: number = DEFAULT_PEAK_COUNT
): number[] {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / peakCount));
  const peaks: number[] = [];

  for (let i = 0; i < peakCount; i++) {
    const start = i * step;
    let max = 0;
    for (let j = 0; j < step && start + j < data.length; j++) {
      const v = Math.abs(data[start + j]);
      if (v > max) max = v;
    }
    peaks.push(Math.round(max * 10000) / 10000); // 4 decimal precision
  }

  return peaks;
}

/**
 * Draw waveform from peaks array onto a canvas.
 * Handles DPR scaling internally.
 */
export function drawPeaksWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  color: string = "hsl(175 50% 45%)",
  fillAlpha: number = 0.15
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = "hsl(220 15% 8%)";
  ctx.fillRect(0, 0, w, h);

  if (!peaks.length) return;

  const mid = h / 2;
  const xStep = w / peaks.length;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();

  // Top half
  for (let i = 0; i < peaks.length; i++) {
    const x = i * xStep;
    const y = mid - peaks[i] * mid * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  // Bottom half (mirror)
  for (let i = peaks.length - 1; i >= 0; i--) {
    const x = i * xStep;
    const y = mid + peaks[i] * mid * 0.9;
    ctx.lineTo(x, y);
  }

  ctx.closePath();

  // Parse color for fill with alpha
  ctx.fillStyle = color.replace(")", ` / ${fillAlpha})`).replace("hsl(", "hsl(");
  ctx.fill();
  ctx.stroke();
}
