import { Home, Mic2, AudioWaveform, User, Sun, Moon, Globe, BookOpen } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import { useState } from "react";

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
import { cn } from "@/lib/utils";

const mainNav = [
  { title: "Главная", titleEn: "Home", url: "/", icon: Home },
  { title: "Парсер", titleEn: "Parser", url: "/parser", icon: BookOpen },
  { title: "Студия", titleEn: "Studio", url: "/studio", icon: AudioWaveform },
  { title: "Дикторы", titleEn: "Narrators", url: "/narrators", icon: Mic2 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [lang, setLang] = useState<"ru" | "en">("ru");

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const toggleLang = () => setLang((l) => (l === "ru" ? "en" : "ru"));

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      {/* Logo */}
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="h-8 w-8 min-w-[2rem] rounded-md gradient-cyan flex items-center justify-center shadow-cool">
            <AudioWaveform className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="font-display text-base font-semibold text-foreground tracking-tight whitespace-nowrap">
              AI Booker
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={collapsed ? (lang === "ru" ? item.title : item.titleEn) : undefined}
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-accent/50"
                      activeClassName="bg-accent text-accent-foreground"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && (
                        <span className="font-body text-sm">
                          {lang === "ru" ? item.title : item.titleEn}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

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
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
