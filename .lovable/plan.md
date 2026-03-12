

## Plan: Tabs for Channel Plugins + Convolution Reverb Storage

This is a large feature set. I'll break it into 3 phases as you suggested.

---

### Phase 1: Reorganize plugins into two tabs

**What changes:**

1. **`ChannelPluginsPanel.tsx`** — wrap existing EQ/Compressor/Limiter content in a `Tabs` component with two tabs:
   - **Tab 1: "Динамические процессоры" / "Dynamics"** — contains existing EQ + Compressor + Limiter (no changes to their logic)
   - **Tab 2: "Пространственная обработка" / "Spatial"** — placeholder with future sections: Stereo Width, Stage Placement, Convolution Reverb

2. The header (track name + PRE/POST badge) stays above the tabs. Tabs fill remaining height.

3. Tab state persisted in component local state (no need for cloud/localStorage since it resets per session).

---

### Phase 2: Convolution Impulse Response storage

**Database:**
- New table `convolution_impulses` with columns: `id`, `name`, `description`, `category` (e.g. hall, room, plate, chamber), `file_path` (in storage), `duration_ms`, `sample_rate`, `channels`, `uploaded_by` (user_id), `is_public` (boolean, default true), `created_at`
- RLS: admin can INSERT/UPDATE/DELETE (via `has_role`), all authenticated users can SELECT where `is_public = true`

**Storage:**
- New folder prefix `impulses/` in existing `user-media` bucket (or a dedicated public bucket `impulse-responses` since all users need read access)
- Better approach: create a **public** bucket `impulse-responses` so all authenticated users can download impulses without signed URLs

**Admin upload UI:**
- New section in Admin page (or Profile admin area) for managing impulse files: upload WAV/FLAC, fill name/category/description, delete

---

### Phase 3: Spatial processing plugins (future)

Stereo Width, Stage Placement, and Convolution Reverb controls in Tab 2. These require audio engine extensions (not in this plan).

---

### Implementation order

I recommend starting with **Phase 1** (tab reorganization) — it's purely UI, no backend, quick to ship. Then **Phase 2** (impulse storage + admin upload). Phase 3 depends on audio engine work.

**Shall I proceed with Phase 1?**

### Technical details

- Uses existing `@radix-ui/react-tabs` (already in project)
- `ChannelPluginsPanel` gets inner `<Tabs>` below header
- Each `<TabsContent>` gets `className="flex-1 min-h-0 overflow-auto"` to fill height
- Phase 2 migration SQL creates table + bucket + RLS policies in one migration
- Admin upload uses `supabase.storage.from('impulse-responses').upload(...)` + insert into `convolution_impulses`

