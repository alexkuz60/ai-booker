---
name: Firefox OPFS Persistence
description: In Firefox OPFS is best-effort by default — must call navigator.storage.persist() with user gesture or models evict on reload
type: constraint
---
В Firefox OPFS считается "best-effort" хранилищем по умолчанию. Большие ONNX-модели (RVC, LLM, Whisper) могут вытесняться даже после простой перезагрузки страницы, если сайт не получил `persisted` permission.

**Решение** в `src/lib/vcModelCache.ts`:
- `requestPersistence()` вынесен в публичный экспорт, вызывается **внутри user-gesture handler** (клик "Скачать").
- Сначала проверяется `navigator.storage.persisted()` — если уже granted, повторный запрос не нужен.
- `checkPersistence()` для пассивной проверки на маунте без запроса разрешения.
- В `VoiceLab` ModelsPanel показывается красный Alert с кнопкой "Запросить разрешение", если `persisted === false`.

**Скачивание ONNX-моделей** также переписано на потоковую запись (writable.write per chunk) вместо накопления в массив `chunks[]` + `new Blob()` — снижает RAM-пик и позволяет писать модели >500MB в Firefox без OOM. Добавлена пост-верификация размера файла.

**Why:** Firefox без persist может молча терять OPFS даже между reload'ами; Chrome/Edge обычно дают persist автоматически по engagement score, поэтому проблема воспроизводится преимущественно на Firefox.
