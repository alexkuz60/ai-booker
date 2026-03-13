# AI-Booker — AI-Powered Audiobook Production Studio

> Transform books into immersive audio plays with AI-driven voice acting, atmospheric soundscapes, and professional mastering — all in one click.

🌐 **Live:** [booker-studio.lovable.app](https://booker-studio.lovable.app)

---

## What is AI-Booker?

AI-Booker is a web application for automated audiobook production in a **radio play format**. It combines deep semantic text analysis, multi-voice TTS synthesis, atmospheric sound design, and a professional DAW-style timeline — powered by AI at every stage.

### Key Features

| Feature | Description |
|---------|-------------|
| 📖 **Smart Parser** | Upload PDF → automatic TOC extraction → AI scene segmentation with mood/tempo metadata |
| 🎭 **Character Profiler** | AI identifies characters, builds psychological profiles, and auto-casts voices |
| 🎙️ **Multi-Provider TTS** | Yandex SpeechKit, SaluteSpeech (Sber), ElevenLabs, ProxyAPI/OpenAI — 40+ voices with emotional control |
| 🎬 **Storyboard Editor** | Segment merge/split, silence pauses, inline narration detection, speaker attribution |
| 🎵 **Atmosphere Engine** | AI-generated ambient sounds, music & SFX (ElevenLabs) + Freesound.org integration |
| 🎛️ **DAW Timeline** | Multi-track playback, per-track mixer, master effects chain (EQ→CMP→LIM→FLT→MBC→REV) |
| 🔌 **Per-Clip Plugins** | Individual EQ, Compressor, Limiter, 3D Panner, Convolver (IR) per clip |
| 🏛️ **Convolution Reverb** | IR library (7 categories), waveform preview, real-time clip audition through IR |
| 🎞️ **Offline Render** | Scene → 3 WAV stems (Voice/Atmo/SFX) with per-clip FX via OfflineAudioContext |
| 🔊 **Pro Mastering** | 5-band parametric filter, 3-band multiband compressor, stereo VU metering, FFT spectrum with click-to-analyze (frequency + note/octave detection) |
| 🤖 **AI Roles** | 6 specialized AI roles (Screenwriter, Profiler, Director, etc.) with dedicated models |
| 💬 **AI Assistant** | Context-aware chat assistant that guides through the production workflow |
| 🎬 **Montage Workspace** | Final chapter assembly: 3-stem timeline (Voice/Atmo/SFX), per-clip Trim/Fade with Undo/Redo, chapter splitting, stereo waveform editor with click-cursor frequency analysis, full mastering chain |

---

## Production Pipeline

```
PDF File
  │
  ▼
┌─────────────────────────────────┐
│  1. Upload + Storage            │  Parser / Library
│  2. TOC Extraction              │
│  3. Manual Structure Editing    │  Navigator
│  4. Semantic Analysis           │  AI → scene boundaries → metadata
└─────────────┬───────────────────┘
              │  🎬 Send to Studio
              ▼
┌─────────────────────────────────┐
│  5. Storyboard (segmentation)   │  AI → typed segments + phrases
│     5a. Block editing           │  Merge / Split / Delete + silence
│  6. Character profiling         │  AI → psychological portraits
│  7. Voice casting               │  Auto-cast + manual override
│  8. Preview                     │  Yandex / ElevenLabs / ProxyAPI
│  9. Scene synthesis             │  TTS → segment_audio → timeline
│  10. Timeline (Scene/Chapter)   │  Playback, seek, navigation
│  10a. Mixer                     │  Vol/Pan/Mute/Solo, Pre-FX, Reverb
│  10b. Mastering                 │  EQ→CMP→LIM→FLT→MBC→REV
│  10c. Metering                  │  Stereo VU L/R, FFT Spectrum
│  10d. Per-Clip Plugins          │  EQ→CMP→LIM→PAN3D→CONV
│  10e. Render to Stems           │  Voice/Atmo/SFX → WAV
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│  11. Atmosphere + SFX           │  Auto + Freesound + manual
│  12. **Montage Workspace**      │  ✅ 3-stem timeline, chapter parts, waveform editor, mastering
│  13. Final export                 │  ⬜
└─────────────────────────────────┘

🤖 Assistant — available at any stage
🎭 AI Roles — specialized models for each task type
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion |
| Audio Engine | Tone.js + Web Audio API (OfflineAudioContext, Convolver, Panner3D, EQ, Compressor, Limiter, FFT) |
| PDF Processing | pdfjs-dist (browser-side) |
| AI Analysis | Lovable AI Gateway (Gemini, GPT-5), ProxyAPI, OpenRouter |
| TTS | Yandex SpeechKit (v1/v3), SaluteSpeech (Sber), ElevenLabs, ProxyAPI/OpenAI TTS |
| Sound Design | ElevenLabs (SFX, Music), Freesound.org |
| Backend | Lovable Cloud (PostgreSQL + Storage + Edge Functions) |
| Auth | Email + password, Row-Level Security on all tables |

---

## AI Roles System

Each AI task in the pipeline is handled by a specialized "role" with its own system prompt and optimal model:

| Role | Responsibility | Model Tier |
|------|---------------|------------|
| 🌐 Translator | i18n, localization | lite |
| ✍️ Proofreader | Stress marks, SSML, TTS punctuation | standard |
| 🎬 Screenwriter | Text segmentation, speaker attribution | standard |
| 🎭 Director | Tempo, pauses, emotional arc | heavy |
| 🔍 Profiler | Character analysis, psychotypes | heavy |
| 🎵 Sound Engineer | SFX/atmosphere prompts | standard |

---

## Getting Started

```bash
# Clone the repository
git clone <YOUR_GIT_URL>

# Install dependencies
npm install

# Start development server
npm run dev
```

---

## Documentation

| File | Contents |
|------|----------|
| [STRATEGY.md](STRATEGY.md) | Strategic plan, architecture, module roadmap |
| [WORKFLOW.md](WORKFLOW.md) | Complete production pipeline documentation |
| [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) | Implementation log with plan vs reality analysis |
| [README_RU.md](README_RU.md) | Документация на русском языке |

---

## License

Private project. All rights reserved.
