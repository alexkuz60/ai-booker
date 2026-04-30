# ComfyUI Audio Nodes — Stack Map for booker-gpu-server

**Purpose:** Inventory of community ComfyUI custom nodes that cover the audio-processing
needs of `booker-gpu-server`. This file is a **research reference**, not source code.
Per [external-repo-protocol](../memory/tech/policy/external-repo-protocol.md), none of
these repos are mirrored into the Lovable project — they live (or will live) inside
the separate `booker-gpu-server` repo, installed as ComfyUI custom_nodes.

Last updated: 2026-04-30.

---

## Node inventory

### 1. OmniVoice TTS — voice synthesis core
- **Repo:** https://github.com/Saganaki22/ComfyUI-OmniVoice-TTS
- **Role:** Wraps k2-fsa/OmniVoice (Qwen3 + Higgs tokenizer) as ComfyUI nodes.
  Voice Design + Voice Cloning, OpenAI-compatible parameter surface.
- **Why we care:** Drop-in replacement for our local OmniVoice server. Lets the GPU
  server expose the same `/v1/audio/speech` contract Booker Studio already speaks
  (see `useOmniVoiceServer.ts`, `OmniVoiceServerCard.tsx`).
- **Integration note:** Should preserve our `psycho_tags → OmniVoiceAdvancedParams`
  mapping (see `omnivoice-psychotype-advanced` memory).

### 2. Stable Audio Sampler — music / SFX generation
- **Repo:** https://github.com/lks-ai/ComfyUI-StableAudioSampler
- **Role:** Stable Audio Open inference inside ComfyUI. Text-to-audio for ambience,
  short music beds, abstract SFX.
- **Why we care:** Replaces the ElevenLabs Music + SFX edge functions
  (`elevenlabs-music`, `elevenlabs-sfx`) for users who run the GPU server. Same
  use case as our atmosphere/SFX layers in storyboard.

### 3. Audio Separation Nodes — stem splitting
- **Repo:** https://github.com/christian-byrne/audio-separation-nodes-comfyui
- **Role:** Demucs/UVR5-style source separation (vocals, drums, bass, other).
- **Why we care:** Needed for VC reference audio cleanup (extract clean vocals from
  noisy reference clips before feeding to RVC), and for re-mastering imported music
  beds. Aligns with the `booker-gpu-server-roadmap` memory's "Demucs/UVR5" line item.

### 4. Audio Quality Enhancer — denoise / restoration
- **Repo:** https://github.com/ShmuelRonen/ComfyUI-Audio_Quality_Enhancer
- **Role:** Single-pass quality improvement (denoise, de-reverb, EQ polish).
- **Why we care:** Pre-processing for user-uploaded voice references in Voice Lab,
  and post-processing for OmniVoice clones that come out slightly noisy.

### 5. AudioTools — utility primitives
- **Repo:** https://github.com/Urabewe/ComfyUI-AudioTools
- **Role:** Trim, fade, gain, concat, sample-rate conversion, basic mixing.
- **Why we care:** Building blocks for assembling per-scene render pipelines on the
  server side. Mirrors the non-destructive Trim/Fade contract from our Montage
  Workspace memory.

### 6. Egregora Audio Super Resolution — upsampling
- **Repo:** https://github.com/lucasgattas/ComfyUI-Egregora-Audio-Super-Resolution
- **Role:** Bandwidth extension / super-resolution for low-rate audio.
- **Why we care:** Lets us accept 16/22 kHz reference clips and bring them up to our
  44.1 kHz / 16-bit standard (see `wav-storage-standard` memory) without manual
  resampling artifacts.

---

## How this maps to our pipeline

```
Booker Studio (Lovable)                booker-gpu-server (separate repo)
─────────────────────────              ──────────────────────────────────
Storyboard / Scene plan      ─HTTP─►   ComfyUI workflow:
                                         ├─ OmniVoice TTS         (#1)
                                         ├─ Voice Conversion      (RVC nodes, TBD)
                                         ├─ Audio Quality Enh.    (#4)
                                         ├─ Stable Audio Sampler  (#2) — atmo/SFX
                                         ├─ AudioTools            (#5) — assemble
                                         └─ Super Resolution      (#6) — final polish
                                       ↓
                                       /v1/audio/* response
                                       ↓
OPFS (44.1k/16-bit WAV)      ◄─────── server WAV stream
```

Audio Separation (#3) sits in a parallel "reference prep" workflow, not in the
main render path.

---

## Open questions (for the gpu-server side, not Lovable)

1. **RVC node** — none of the six listed cover RVC v2 directly. Either fork an
   existing one or wrap our own (we already own the ONNX path in `vcPipeline.ts`,
   could re-use the Python equivalents).
2. **App Mode** — ComfyUI's new App Mode (mentioned in earlier chat) could expose
   each composed workflow as a single endpoint, hiding the node graph from
   `booker-gpu-server`'s HTTP layer. Worth prototyping after the basic stack works.
3. **Hot-swap / VRAM pool** — per `booker-gpu-server-roadmap` memory, we want one
   CUDA context with LRU model eviction. ComfyUI's default model manager already
   does some of this; need to verify it doesn't fight our scheduler.

---

## Reminder — protocol compliance

- ✅ This file is `.md` only, in `.lovable/research/`
- ✅ No `.py` / `.ts` from upstream copied anywhere
- ✅ Lovable project unchanged
- 👉 Actual integration work happens in the separate `booker-gpu-server` repo
