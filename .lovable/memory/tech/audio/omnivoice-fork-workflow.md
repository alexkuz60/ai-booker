---
name: OmniVoice fork workflow (ARCHIVED)
description: ARCHIVED 2026-04-22 — fork no longer needed; upstream k2-fsa fixed audio.py. Kept for historical context only.
type: reference
---

# OmniVoice Server — Fork Workflow (ARCHIVED 2026-04-22)

> **Status:** ARCHIVED. Do not use. Kept only as historical context.
>
> **Reason:** Upstream `k2-fsa/OmniVoice` fixed the `tensor_to_wav_bytes()` WAV
> encoding bug in master (commit ~2026-04-22). The fork
> `alexkuz60/BookerLab_OmniVoice` is no longer required.
>
> **Current install (vanilla, both upstreams):**
>
> ```bash
> pip install --force-reinstall \
>   "git+https://github.com/k2-fsa/OmniVoice.git" \
>   "git+https://github.com/maemreyo/omnivoice-server.git@main"
> ```
>
> **Regression canary:** `scripts/dev-omnivoice.sh` greps the installed
> `omnivoice/utils/audio.py` for the `PCM_16` marker on every launch. If
> upstream ever reverts the fix we'll see a loud warning and can re-fork.
>
> The original fork branch (`booker-patches`) can be archived/deleted on the
> GitHub side.

---

## Original (historical) content

We previously maintained `alexkuz60/BookerLab_OmniVoice@booker-patches` with a
hand-written patch to `omnivoice/utils/audio.py` (`cpu()` + transpose +
`sf.write(..., subtype="PCM_16")` at 24 kHz). The patch lived inside
`omnivoice-server`'s submodule. We installed it via:

```bash
pip install --force-reinstall \
  "git+https://github.com/alexkuz60/BookerLab_OmniVoice.git@booker-patches"
```

`scripts/dev-omnivoice.sh` checked at startup that the installed package
matched the fork marker and that `audio.py` actually contained `PCM_16`.

That whole layer was removed when upstream merged the equivalent fix.
