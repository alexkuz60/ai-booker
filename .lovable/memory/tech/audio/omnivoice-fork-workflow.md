---
name: OmniVoice fork workflow
description: How we maintain a patched omnivoice-server fork (audio.py WAV fix) without losing the patch on upstream updates
type: feature
---

# OmniVoice Server — Fork Workflow

## Why we have a fork

The vanilla `omnivoice-server` package ships an `audio.py` whose
`tensor_to_wav_bytes()` produces broken WAV output in some cases (multiple
upstream issues open). We patched it locally by trial-and-error to:

- always move tensor to CPU first
- transpose `(channels, samples) → (samples, channels)` when needed
- write 16-bit PCM WAV at 24 kHz via `soundfile`

A plain `pip install -U omnivoice-server` silently overwrites this patch.
To make the patch survive upgrades and be reproducible across machines we
maintain a **fork on GitHub** and install from it.

## One-time setup

1. Fork `k2-fsa/omnivoice-server` on GitHub → `<your-user>/omnivoice-server`.
2. Clone locally:
   ```bash
   git clone https://github.com/<your-user>/omnivoice-server.git
   cd omnivoice-server
   git remote add upstream https://github.com/k2-fsa/omnivoice-server.git
   git fetch upstream
   ```
3. Create a long-lived branch for our patches:
   ```bash
   git checkout -b booker-patches upstream/main
   ```
4. Apply the `audio.py` fix as **one focused commit**:
   ```
   fix(audio): correct WAV encoding in tensor_to_wav_bytes

   Refs: <link-to-upstream-issue-1>, <link-to-upstream-issue-2>
   See: .lovable/memory/tech/audio/omnivoice-audio-py-pr-template.md
   ```
   Keep the diff minimal — only the bytes that actually need to change.
   This makes future rebases trivial.
5. Push:
   ```bash
   git push -u origin booker-patches
   ```

## Install on a dev machine (replaces `pip install omnivoice-server`)

```bash
pip install --force-reinstall \
  "git+https://github.com/<your-user>/omnivoice-server.git@booker-patches"
```

`scripts/dev-omnivoice.sh` checks at startup whether the installed package
points to our fork and prints a loud warning if it doesn't (e.g. after an
accidental `pip install -U omnivoice-server`).

## Periodic upstream sync (every ~2 weeks or when upstream releases)

```bash
cd omnivoice-server
git fetch upstream
git checkout booker-patches
git rebase upstream/main
# resolve conflicts in audio.py if any
git push --force-with-lease
```

If the rebase reports **no conflicts in `audio.py` and the file content matches
upstream**, that means upstream has merged a fix → drop our commit and switch
back to vanilla:

```bash
pip install --force-reinstall omnivoice-server
# then delete the fork or archive the booker-patches branch
```

## Update checklist (when bumping the patched version)

- [ ] `git fetch upstream && git rebase upstream/main` clean
- [ ] `pip install --force-reinstall git+...@booker-patches`
- [ ] `omnivoice-server --device cuda` starts
- [ ] `scripts/dev-omnivoice.sh` reports fork install + all required probes pass
- [ ] Voice Cloning round-trip in VoiceLab produces a playable WAV (no clicks/silence)
- [ ] If upstream merged the fix → uninstall fork, document removal here

## Files involved on our side

- `scripts/dev-omnivoice.sh` — install-source check + warning
- `.lovable/memory/tech/audio/omnivoice-audio-py-pr-template.md` — PR description
- `.lovable/memory/tech/audio/omnivoice-fork-workflow.md` — this file
