/**
 * DeleteModelButton — Trash icon wrapped in AlertDialog confirmation.
 *
 * Used by all model managers (VC, OmniVoice, Whisper) to prevent accidental
 * cache deletion. Shows model name in the confirmation prompt.
 */
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  isRu: boolean;
  modelName: string;
  onConfirm: () => void | Promise<void>;
  /** Visual variant: "icon" (small ghost icon) or "compact" (h-6 w-6 inline). */
  variant?: "icon" | "compact";
  title?: string;
  disabled?: boolean;
}

export function DeleteModelButton({
  isRu, modelName, onConfirm, variant = "compact", title, disabled,
}: Props) {
  const sizeClasses =
    variant === "compact" ? "h-6 w-6 p-0" : "h-7 w-7 p-0";
  const iconSize = variant === "compact" ? "w-3 h-3" : "h-3.5 w-3.5";

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={`${sizeClasses} text-muted-foreground hover:text-destructive`}
          title={title ?? (isRu ? "Удалить из кэша" : "Remove from cache")}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className={iconSize} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRu ? "Удалить модель из кэша?" : "Remove model from cache?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRu ? (
              <>
                Будут удалены файлы модели <span className="font-mono font-semibold">{modelName}</span> из локального
                браузерного кэша. Чтобы пользоваться ей снова, потребуется повторная загрузка.
              </>
            ) : (
              <>
                Cached files for <span className="font-mono font-semibold">{modelName}</span> will be removed from the
                local browser cache. You will need to re-download the model to use it again.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void onConfirm()}
          >
            {isRu ? "Удалить" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
