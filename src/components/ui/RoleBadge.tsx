/**
 * RoleBadge — "Клеймо мастера"
 * Shows a colored icon for each AI role with a tooltip indicating the model used.
 */
import {
  Languages, SpellCheck, Clapperboard, Megaphone, UserSearch, AudioWaveform,
  BookOpen, Pen, ShieldCheck,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import type { AiRoleId } from "@/config/aiRoles";
import { AI_ROLES } from "@/config/aiRoles";
import { cn } from "@/lib/utils";

const ROLE_VISUALS: Record<AiRoleId, {
  icon: typeof Languages;
  /** Tailwind text color class — uses semantic/utility palette */
  color: string;
}> = {
  translator:          { icon: Languages,      color: "text-sky-400" },
  proofreader:         { icon: SpellCheck,      color: "text-emerald-400" },
  screenwriter:        { icon: Clapperboard,    color: "text-amber-400" },
  director:            { icon: Megaphone,       color: "text-purple-400" },
  profiler:            { icon: UserSearch,      color: "text-rose-400" },
  sound_engineer:      { icon: AudioWaveform,   color: "text-cyan-400" },
  art_translator:      { icon: BookOpen,        color: "text-indigo-400" },
  literary_editor:     { icon: Pen,             color: "text-orange-400" },
  translation_critic:  { icon: ShieldCheck,     color: "text-teal-400" },
};

interface RoleBadgeProps {
  roleId: AiRoleId;
  /** Model name to show in tooltip */
  model?: string;
  isRu?: boolean;
  /** Icon size in px */
  size?: number;
  className?: string;
}

export function RoleBadge({ roleId, model, isRu = false, size = 14, className }: RoleBadgeProps) {
  const visual = ROLE_VISUALS[roleId];
  const role = AI_ROLES[roleId];
  if (!visual || !role) return null;

  const Icon = visual.icon;
  const label = isRu ? role.labelRu : role.labelEn;
  const modelLabel = model
    ? model.replace(/^(google|openai)\//, "")
    : (isRu ? "по умолчанию" : "default");

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center shrink-0 cursor-default", className)}>
            <Icon className={cn(visual.color, "drop-shadow-sm")} style={{ width: size, height: size }} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          <span className="font-semibold">{label}</span>
          <br />
          <span className="text-muted-foreground font-mono text-[10px]">{modelLabel}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Renders multiple role badges inline */
export function RoleBadges({ roles, isRu, size, className }: {
  roles: { roleId: AiRoleId; model?: string }[];
  isRu?: boolean;
  size?: number;
  className?: string;
}) {
  if (!roles.length) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {roles.map(r => (
        <RoleBadge key={r.roleId} roleId={r.roleId} model={r.model} isRu={isRu} size={size} />
      ))}
    </span>
  );
}
