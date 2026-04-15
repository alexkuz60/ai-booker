import { useState } from "react";
import { Home, Library, Mic2, AudioWaveform, User, Sun, Moon, Globe, BookOpen, LogOut, Shield, MessageCircle, Film, Waves, Languages, Lock, FlaskConical } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useLanguage } from "@/hooks/useLanguage";
import { usePipelineGating } from "@/hooks/usePipelineGating";
import { AssistantChat } from "@/components/AssistantChat";
import { toast } from "sonner";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const mainNav = [
  { title: "Главная", titleEn: "Home", url: "/", icon: Home },
  { title: "Библиотека", titleEn: "Library", url: "/library", icon: Library },
  { title: "Парсер", titleEn: "Parser", url: "/parser", icon: BookOpen },
  { title: "Студия", titleEn: "Studio", url: "/studio", icon: AudioWaveform },
  { title: "Монтаж", titleEn: "Montage", url: "/montage", icon: Film },
  { title: "Дикторы", titleEn: "Narrators", url: "/narrators", icon: Mic2 },
  { title: "Звуки", titleEn: "Soundscape", url: "/soundscape", icon: Waves },
];

const extraNav = [
  { title: "Арт-перевод", titleEn: "Translation", url: "/translation", icon: Languages },
];

const labNav = [
  { title: "Голос. лаб.", titleEn: "Voice Lab", url: "/voice-lab", icon: FlaskConical },
];

export function AppSidebar() {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const { signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { lang, isRu, toggleLang } = useLanguage();
  const { isLocked, lockReason } = usePipelineGating();

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const handleNavClick = (url: string, e: React.MouseEvent) => {
    if (isLocked(url)) {
      e.preventDefault();
      const reason = lockReason(url, isRu);
      if (reason) toast.warning(reason);
    }
  };

  const renderNavItem = (item: typeof mainNav[0]) => {
    const locked = isLocked(item.url);
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.url)}
          tooltip={collapsed ? (lang === "ru" ? item.title : item.titleEn) + (locked ? " 🔒" : "") : undefined}
        >
          <NavLink
            to={locked ? "#" : item.url}
            end={item.url === "/"}
            className={cn("hover:bg-accent/50", locked && "opacity-40 cursor-not-allowed")}
            activeClassName="bg-accent text-accent-foreground"
            onClick={(e: React.MouseEvent) => handleNavClick(item.url, e)}
          >
            <item.icon className="h-4 w-4" />
            {!collapsed && (
              <span className="font-body text-sm flex items-center gap-1.5">
                {lang === "ru" ? item.title : item.titleEn}
                {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
              </span>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <>
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      {/* Logo */}
      <SidebarHeader className="px-3 py-4">
        <button
          onClick={toggleSidebar}
          className="flex items-center gap-2.5 overflow-hidden hover:opacity-80 transition-opacity focus:outline-none"
        >
          <div className="h-8 w-8 min-w-[2rem] rounded-md gradient-cyan flex items-center justify-center shadow-cool">
            <AudioWaveform className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="font-display text-base font-semibold text-foreground tracking-tight whitespace-nowrap">
              AI Booker
            </span>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="mx-3 my-1" />

        {/* Extra: Translation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {extraNav.map(renderNavItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="mx-3 my-1" />

        {/* Experimental: Voice Lab */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {labNav.map((item) => {
                const locked = isLocked(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={collapsed ? (lang === "ru" ? item.title : item.titleEn) + (locked ? " 🔒" : "") + " 🧪" : undefined}
                    >
                      <NavLink
                        to={locked ? "#" : item.url}
                        end={false}
                        className={cn(
                          "hover:bg-red-500/10 text-red-400/80 hover:text-red-400",
                          locked && "opacity-40 cursor-not-allowed",
                          isActive(item.url) && "bg-red-500/15 text-red-400"
                        )}
                        activeClassName="bg-red-500/15 text-red-400"
                        onClick={(e: React.MouseEvent) => handleNavClick(item.url, e)}
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && (
                          <span className="font-body text-sm flex items-center gap-1.5">
                            {lang === "ru" ? item.title : item.titleEn}
                            {locked && <Lock className="h-3 w-3" />}
                          </span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      {/* Footer: toggles + profile */}
      <SidebarFooter className="px-2 pb-3 space-y-1">
        <Separator className="mb-2" />

        {/* Language toggle */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleLang}
              tooltip={collapsed ? (lang === "ru" ? "English" : "Русский") : undefined}
              className="hover:bg-accent/50"
            >
              <Globe className="h-4 w-4" />
              {!collapsed && (
                <span className="font-body text-sm uppercase tracking-wider">
                  {lang === "ru" ? "Ру" : "En"}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Theme toggle */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleTheme}
              tooltip={collapsed ? (theme === "dark" ? "Светлая тема" : "Тёмная тема") : undefined}
              className="hover:bg-accent/50"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              {!collapsed && (
                <span className="font-body text-sm">
                  {theme === "dark"
                    ? lang === "ru" ? "Светлая" : "Light"
                    : lang === "ru" ? "Тёмная" : "Dark"}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Admin Panel - only for admins */}
          {isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive("/admin")}
                tooltip={collapsed ? (isRu ? "Админ-панель" : "Admin Panel") : undefined}
              >
                <NavLink
                  to="/admin"
                  className="hover:bg-accent/50"
                  activeClassName="bg-accent text-accent-foreground"
                >
                  <Shield className="h-4 w-4" />
                  {!collapsed && (
                    <span className="font-body text-sm">
                      {isRu ? "Админ-панель" : "Admin Panel"}
                    </span>
                  )}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {/* Assistant */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setAssistantOpen(true)}
              tooltip={collapsed ? (isRu ? "Ассистент" : "Assistant") : undefined}
              className="hover:bg-accent/50"
            >
              <MessageCircle className="h-4 w-4" />
              {!collapsed && (
                <span className="font-body text-sm">
                  {isRu ? "Ассистент" : "Assistant"}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Profile */}
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive("/profile")}
              tooltip={collapsed ? (lang === "ru" ? "Профиль" : "Profile") : undefined}
            >
              <NavLink
                to="/profile"
                className="hover:bg-accent/50"
                activeClassName="bg-accent text-accent-foreground"
              >
                <User className="h-4 w-4" />
                {!collapsed && (
                  <span className="font-body text-sm">
                    {lang === "ru" ? "Профиль" : "Profile"}
                  </span>
                )}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Logout */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={signOut}
              tooltip={collapsed ? (lang === "ru" ? "Выход" : "Logout") : undefined}
              className="hover:bg-destructive/20 hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && (
                <span className="font-body text-sm">
                  {lang === "ru" ? "Выход" : "Logout"}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
    <AssistantChat open={assistantOpen} onOpenChange={setAssistantOpen} />
    </>
  );
}
