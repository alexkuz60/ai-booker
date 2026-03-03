import { motion } from "framer-motion";
import { ChevronRight, ChevronDown, Mic2, Wind, Volume2 } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

// Mock book structure
const bookStructure = [
  {
    id: "ch1",
    title: "Глава 1. Начало",
    children: [
      { id: "ch1-1", title: "Эпизод 1.1", children: [] },
      { id: "ch1-2", title: "Эпизод 1.2", children: [
        { id: "ch1-2-1", title: "Сцена A", children: [] },
        { id: "ch1-2-2", title: "Сцена B", children: [] },
      ]},
    ],
  },
  {
    id: "ch2",
    title: "Глава 2. Развитие",
    children: [
      { id: "ch2-1", title: "Эпизод 2.1", children: [] },
    ],
  },
  {
    id: "ch3",
    title: "Глава 3. Кульминация",
    children: [],
  },
];

interface TreeNode {
  id: string;
  title: string;
  children: TreeNode[];
}

function TreeItem({ node, depth = 0, selected, onSelect }: {
  node: TreeNode;
  depth?: number;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  if (!hasChildren) {
    return (
      <button
        onClick={() => onSelect(node.id)}
        className={cn(
          "w-full text-left px-3 py-1.5 text-sm font-body rounded-md transition-colors",
          "hover:bg-accent/50",
          selected === node.id && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        {node.title}
      </button>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-1 px-3 py-1.5 text-sm font-body rounded-md transition-colors",
            "hover:bg-accent/50",
            selected === node.id && "bg-accent text-accent-foreground"
          )}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => onSelect(node.id)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.title}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {node.children.map((child) => (
          <TreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

const Studio = () => {
  const [selectedNode, setSelectedNode] = useState("ch1");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <h1 className="font-display text-2xl font-bold text-foreground">Студия</h1>
        <p className="text-sm text-muted-foreground font-body">Рабочая панель</p>
      </div>

      {/* Two-column workspace */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left: Book navigation */}
          <ResizablePanel defaultSize={30} minSize={15} maxSize={50}>
            <div className="h-full flex flex-col border-r border-border">
              <div className="px-4 py-3 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
                  Структура книги
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-2 px-1 space-y-0.5">
                  {bookStructure.map((node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      selected={selectedNode}
                      onSelect={setSelectedNode}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: Tabs workspace */}
          <ResizablePanel defaultSize={70}>
            <div className="h-full flex flex-col p-4">
              <Tabs defaultValue="narrators" className="flex-1 flex flex-col">
                <TabsList className="w-fit">
                  <TabsTrigger value="narrators" className="gap-1.5">
                    <Mic2 className="h-3.5 w-3.5" />
                    <span className="font-body text-sm">Дикторы</span>
                  </TabsTrigger>
                  <TabsTrigger value="atmosphere" className="gap-1.5">
                    <Wind className="h-3.5 w-3.5" />
                    <span className="font-body text-sm">Атмосфера</span>
                  </TabsTrigger>
                  <TabsTrigger value="sounds" className="gap-1.5">
                    <Volume2 className="h-3.5 w-3.5" />
                    <span className="font-body text-sm">Звуки</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="narrators" className="flex-1 mt-4">
                  <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                    <p className="text-sm text-muted-foreground font-body">
                      Управление дикторами для выбранного раздела
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="atmosphere" className="flex-1 mt-4">
                  <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                    <p className="text-sm text-muted-foreground font-body">
                      Фоновая атмосфера и эмбиент
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="sounds" className="flex-1 mt-4">
                  <div className="rounded-lg border border-border bg-card/50 h-full flex items-center justify-center">
                    <p className="text-sm text-muted-foreground font-body">
                      Конкретные звуковые эффекты
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </motion.div>
  );
};

export default Studio;
