---
name: OmniVoice audio.py PR template
description: Draft PR description for upstreaming the audio.py WAV-encoding fix to k2-fsa/omnivoice-server
type: reference
---

# Upstream PR draft — `audio.py`: correct WAV encoding in `tensor_to_wav_bytes`

> Copy/adapt this when opening the PR against `k2-fsa/omnivoice-server`.
> Replace `<...>` placeholders before submitting.

---

## Title

`fix(audio): make tensor_to_wav_bytes robust to device, dtype and channel layout`

## Summary

`tensor_to_wav_bytes()` in `audio.py` currently produces invalid or silent WAV
output in several real-world cases:

1. Tensor lives on a non-CPU device (CUDA/MPS) → `.numpy()` fails or crashes.
2. Tensor shape is `(channels, samples)` (PyTorch convention) but
   `soundfile.write` expects `(samples, channels)` → channels and samples get
   swapped, producing a tiny, distorted, or empty WAV file.
3. Sample rate is hardcoded inconsistently across call sites.

This PR makes the function defensive without changing the public signature.

## Related issues

- <link to issue #1 about clipped/silent WAV output>
- <link to issue #2 about CUDA tensor crash>
- <link to any discussion / Discord thread>

## Proposed change

```python
SAMPLE_RATE = 24_000

def tensor_to_wav_bytes(tensor):
    # 1. Ensure CPU
    cpu_tensor = tensor.cpu() if hasattr(tensor, "cpu") else tensor
    # 2. Convert to numpy
    data = cpu_tensor.numpy() if hasattr(cpu_tensor, "numpy") else cpu_tensor
    # 3. Normalize channel layout to (samples, channels) for soundfile
    if data.ndim == 2 and data.shape[0] < data.shape[1]:
        data = data.T
    # 4. Encode as 16-bit PCM WAV at the module-level sample rate
    buf = io.BytesIO()
    sf.write(buf, data, samplerate=SAMPLE_RATE, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()
```

Key points:

- `.cpu()` guard makes it work for any backend (CUDA, MPS, XPU).
- The `data.shape[0] < data.shape[1]` heuristic correctly identifies
  `(channels, samples)` tensors in practice (channel count is always much
  smaller than sample count for any realistic audio length).
- Uses the existing module-level `SAMPLE_RATE` constant instead of a magic
  number, so a single edit covers all encoders.
- 16-bit PCM is the de-facto standard for downstream tools (browsers,
  ffmpeg, DAWs); the previous default produced files some players rejected.

## Backwards compatibility

- Public function signature unchanged.
- Mono `(samples,)` tensors and already-correct `(samples, channels)` tensors
  behave identically to before.
- The only behavioural change for callers is that previously-broken outputs
  now decode correctly.

## How we found this

Encountered while integrating OmniVoice into a browser-based audiobook
production tool. WAV blobs returned by `/v1/audio/speech/clone` were
unplayable in Chromium until we patched this function locally. We've been
running the patched version in development for several weeks without
regressions across Voice Design and Voice Cloning modes.

## Test plan

- [ ] Existing unit tests pass.
- [ ] Manual: `POST /v1/audio/speech` with `response_format=wav` returns a
      file that opens in `ffplay`, Audacity, and Chromium `<audio>`.
- [ ] Manual: `POST /v1/audio/speech/clone` with a 24 kHz reference returns
      a playable WAV (no swapped channels, no truncation).
- [ ] Manual: same as above with the model on CUDA and on CPU.

## Checklist

- [ ] PR title follows conventional commits.
- [ ] No new dependencies.
- [ ] Diff limited to `audio.py`.
- [ ] Linked all related issues above.
