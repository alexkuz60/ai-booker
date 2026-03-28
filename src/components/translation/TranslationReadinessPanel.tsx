/**
 * Readiness check & "Create translation project" panel.
 * Extracted from Translation page for modularity.
 */

import { CheckCircle2, AlertCircle, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TranslationReadiness } from "@/lib/translationProject";
import type { ProjectMeta } from "@/lib/projectStorage";

interface Props {
  readiness: TranslationReadiness | null;
  checking: boolean;
  creating: boolean;
  meta: ProjectMeta;
  isRu: boolean;
  onCreateTranslation: () => void;
}

export function TranslationReadinessPanel({
  readiness,
  checking,
  creating,
  meta,
  isRu,
  onCreateTranslation,
}: Props) {
  return (
    <div className="border-b px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {isRu ? "Готовность к переводу" : "Translation Readiness"}
        </h2>
        {checking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {readiness && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{isRu ? "Сцен размечено:" : "Scenes storyboarded:"}</span>
            <Badge variant={readiness.totalReady === readiness.totalScenes ? "default" : "secondary"}>
              {readiness.totalReady} / {readiness.totalScenes}
            </Badge>
          </div>

          {readiness.readyChapters.size > 0 && (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {isRu
                ? `Глав готово: ${readiness.readyChapters.size}`
                : `Chapters ready: ${readiness.readyChapters.size}`}
            </p>
          )}

          {readiness.notReadyChapters.size > 0 && (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {isRu
                ? `Глав не готово: ${readiness.notReadyChapters.size} (нужна раскадровка в Студии)`
                : `Chapters not ready: ${readiness.notReadyChapters.size} (need storyboarding in Studio)`}
            </p>
          )}

          <Button
            size="sm"
            onClick={onCreateTranslation}
            disabled={creating || readiness.readyChapters.size === 0}
            className="w-full mt-2"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {isRu
              ? `Создать проект перевода (${meta.language === "ru" ? "→ EN" : "→ RU"})`
              : `Create translation project (${meta.language === "ru" ? "→ EN" : "→ RU"})`}
          </Button>
        </div>
      )}
    </div>
  );
}
