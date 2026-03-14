import { useState, useCallback } from "react";
import { Bot } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AiRolesTab } from "@/components/profile/tabs/AiRolesTab";
import type { AiRoleId } from "@/config/aiRoles";

interface AiRolesButtonProps {
  isRu: boolean;
  apiKeys: Record<string, string>;
  onModelChanged?: (roleId: AiRoleId) => void;
  bookTitle?: string;
}

export function AiRolesButton({ isRu, apiKeys, onModelChanged, bookTitle }: AiRolesButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Bot className="h-3.5 w-3.5" />
        {isRu ? "AI Роли" : "AI Roles"}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[800px] sm:max-w-[800px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              {isRu ? "AI Роли" : "AI Roles"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <AiRolesTab apiKeys={apiKeys} isRu={isRu} onModelChanged={onModelChanged} bookTitle={bookTitle} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
