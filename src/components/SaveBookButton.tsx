import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveBookButtonProps {
  isRu: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}

export function SaveBookButton({ isRu, loading = false, disabled = false, onClick }: SaveBookButtonProps) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled || loading} className="gap-1.5">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      {isRu ? "Сохранить книгу" : "Save book"}
    </Button>
  );
}
