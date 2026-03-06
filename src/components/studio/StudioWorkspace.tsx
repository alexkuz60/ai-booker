import { useState, useRef } from "react";
import { Users, Wind, Volume2, Film, Wand2, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StoryboardPanel } from "./StoryboardPanel";
import { CharactersPanel, type CharactersPanelHandle } from "./CharactersPanel";
import { AtmospherePanel } from "./AtmospherePanel";

interface StudioWorkspaceProps {
  isRu: boolean;
  selectedSceneId?: string | null;
  selectedSceneContent?: string | null;
  bookId?: string | null;
  chapterSceneIds?: string[];
  onSegmented?: (sceneId: string) => void;
}

export function StudioWorkspace({ isRu, selectedSceneId, selectedSceneContent, bookId, chapterSceneIds, onSegmented }: StudioWorkspaceProps) {
  const [activeTab, setActiveTab] = useState("storyboard");
  const charactersPanelRef = useRef<CharactersPanelHandle | null>(null);
  const [castingExternal, setCastingExternal] = useState(false);

  const handleAutoCast = async () => {
    if (charactersPanelRef.current) {
      setCastingExternal(true);
      await charactersPanelRef.current.autoCast();
      // Chain incremental profiling after voice assignment
      await charactersPanelRef.current.incrementalProfile();
      setCastingExternal(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col p-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between shrink-0">
          <TabsList className="w-fit">
            <TabsTrigger value="storyboard" className="gap-1.5">
              <Film className="h-3.5 w-3.5" />
              <span className="font-body text-sm">{isRu ? "Раскадровка" : "Storyboard"}</span>
            </TabsTrigger>
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
              <span className="font-body text-sm">{isRu ? "Готовые главы" : "Finished Chapters"}</span>
            </TabsTrigger>
          </TabsList>

          {activeTab === "narrators" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleAutoCast}
              disabled={castingExternal}
            >
              {castingExternal ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              {castingExternal
                ? (isRu ? "Подбор и профайлинг..." : "Casting & profiling...")
                : (isRu ? "Подбор Актёров" : "Auto-Cast")}
            </Button>
          )}
        </div>

        <TabsContent value="storyboard" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full">
            <StoryboardPanel
              sceneId={selectedSceneId ?? null}
              sceneContent={selectedSceneContent ?? null}
              isRu={isRu}
              onSegmented={onSegmented}
            />
          </div>
        </TabsContent>

        <TabsContent value="narrators" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full overflow-hidden">
            <CharactersPanel
              ref={charactersPanelRef}
              isRu={isRu}
              bookId={bookId}
              sceneId={selectedSceneId}
              chapterSceneIds={chapterSceneIds}
            />
          </div>
        </TabsContent>

        <TabsContent value="atmosphere" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full overflow-hidden">
            <AtmospherePanel isRu={isRu} />
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
