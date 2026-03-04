import { Users, Wind, Volume2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function StudioWorkspace({ isRu }: { isRu: boolean }) {
  return (
    <div className="h-full min-h-0 flex flex-col p-4">
      <Tabs defaultValue="narrators" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="narrators" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span className="font-body text-sm">{isRu ? "Персонажи" : "Characters"}</span>
          </TabsTrigger>
          <TabsTrigger value="atmosphere" className="gap-1.5">
            <Wind className="h-3.5 w-3.5" />
            <span className="font-body text-sm">{isRu ? "Атмосфера" : "Atmosphere"}</span>
          </TabsTrigger>
          <TabsTrigger value="sounds" className="gap-1.5">
            <Volume2 className="h-3.5 w-3.5" />
            <span className="font-body text-sm">{isRu ? "Звуки" : "Sounds"}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="narrators" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground font-body">
              {isRu ? "Управление персонажами для выбранного раздела" : "Character management for selected section"}
            </p>
          </div>
        </TabsContent>

        <TabsContent value="atmosphere" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground font-body">
              {isRu ? "Фоновая атмосфера и эмбиент" : "Background atmosphere and ambience"}
            </p>
          </div>
        </TabsContent>

        <TabsContent value="sounds" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground font-body">
              {isRu ? "Конкретные звуковые эффекты" : "Sound effects"}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
