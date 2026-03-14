import { useState, useRef, useEffect } from "react";
import { Users, Wind, Headphones, Film, Wand2, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StoryboardPanel } from "./StoryboardPanel";
import { CharactersPanel, type CharactersPanelHandle } from "./CharactersPanel";
import { AtmospherePanel } from "./AtmospherePanel";
import { FinishedChaptersPanel } from "./FinishedChaptersPanel";
import { BatchSegmentationPanel } from "./BatchSegmentationPanel";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { useAiRoles } from "@/hooks/useAiRoles";

interface StudioWorkspaceProps {
  isRu: boolean;
  selectedSceneId?: string | null;
  selectedSceneContent?: string | null;
  bookId?: string | null;
  chapterSceneIds?: string[];
  onSegmented?: (sceneId: string) => void;
  selectedCharacterId?: string | null;
  onSelectCharacter?: (characterId: string | null) => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  onSynthesizingChange?: (ids: Set<string>) => void;
  onErrorSegmentsChange?: (ids: Set<string>) => void;
  silenceSec?: number;
  onSilenceSecChange?: (sec: number) => void;
  onRecalcDone?: () => void;
  onVoiceSaved?: () => void;
  batchSceneIds?: string[] | null;
  batchScenes?: { id: string; title: string; sceneNumber: number; content?: string | null }[];
  onBatchComplete?: () => void;
  onBatchClose?: () => void;
}

export function StudioWorkspace({ isRu, selectedSceneId, selectedSceneContent, bookId, chapterSceneIds, onSegmented, selectedCharacterId, onSelectCharacter, activeTab: externalTab, onTabChange, selectedSegmentId, onSelectSegment, onSynthesizingChange, onErrorSegmentsChange, silenceSec, onSilenceSecChange, onRecalcDone, onVoiceSaved, batchSceneIds, batchScenes, onBatchComplete, onBatchClose }: StudioWorkspaceProps) {
  const [activeTab, setActiveTabLocal] = useState(() => externalTab || sessionStorage.getItem("studio_active_tab") || "storyboard");
  const charactersPanelRef = useRef<CharactersPanelHandle | null>(null);
  const [castingExternal, setCastingExternal] = useState(false);

  // Sync external tab prop
  useEffect(() => {
    if (externalTab && externalTab !== activeTab) {
      setActiveTabLocal(externalTab);
    }
  }, [externalTab]);

  const handleTabChange = (v: string) => {
    setActiveTabLocal(v);
    sessionStorage.setItem("studio_active_tab", v);
    onTabChange?.(v);
  };

  const handleAutoCast = async () => {
    if (charactersPanelRef.current) {
      setCastingExternal(true);
      await charactersPanelRef.current.autoCast();
      // Chain incremental profiling after voice assignment
      await charactersPanelRef.current.incrementalProfile();
      setCastingExternal(false);
    }
  };

  const isBatchMode = batchSceneIds && batchSceneIds.length > 0 && batchScenes && batchScenes.length > 0;

  return (
    <div className="h-full min-h-0 flex flex-col p-4">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
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
            <TabsTrigger value="finished" className="gap-1.5">
              <Headphones className="h-3.5 w-3.5" />
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
            {isBatchMode ? (
              <BatchSegmentationPanel
                isRu={isRu}
                sceneIds={batchSceneIds!}
                scenes={batchScenes!}
                bookId={bookId ?? null}
                concurrency={3}
                onComplete={onBatchComplete}
                onSceneSegmented={onSegmented}
                onClose={onBatchClose}
              />
            ) : (
              <StoryboardPanel
                sceneId={selectedSceneId ?? null}
                sceneContent={selectedSceneContent ?? null}
                isRu={isRu}
                bookId={bookId ?? null}
                onSegmented={onSegmented}
                selectedSegmentId={selectedSegmentId ?? null}
                onSelectSegment={onSelectSegment}
                onSynthesizingChange={onSynthesizingChange}
                onErrorSegmentsChange={onErrorSegmentsChange}
                silenceSec={silenceSec}
                onSilenceSecChange={onSilenceSecChange}
                onRecalcDone={onRecalcDone}
              />
            )}
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
              selectedCharacterId={selectedCharacterId}
              onSelectCharacter={onSelectCharacter}
              onVoiceSaved={onVoiceSaved}
            />
          </div>
        </TabsContent>

        <TabsContent value="atmosphere" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full overflow-hidden">
            <AtmospherePanel isRu={isRu} sceneId={selectedSceneId} />
          </div>
        </TabsContent>

        <TabsContent value="finished" className="flex-1 mt-4 min-h-0">
          <div className="rounded-lg border border-border bg-card/50 h-full overflow-hidden">
            <FinishedChaptersPanel isRu={isRu} bookId={bookId} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
