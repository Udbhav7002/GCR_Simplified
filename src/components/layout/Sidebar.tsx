import { NavLink } from "react-router-dom";
import { LayoutDashboard, Settings, BookOpen, ListChecks } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/courses", icon: BookOpen, label: "Courses" },
];

const bottomItems = [
  { to: "/onboarding", icon: ListChecks, label: "Setup Guide" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="flex flex-col w-64 border-r border-border bg-card h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground">
          <BookOpen className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight">GCR Simplified</h1>
          <p className="text-[11px] text-muted-foreground leading-none">Grade · Check · Report</p>
        </div>
      </div>

      <Separator />

      {/* Main Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`
            }
          >
            <item.icon className="w-4.5 h-4.5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom Nav */}
      <div className="px-3 pb-4 space-y-1">
        <Separator className="mb-3" />
        {bottomItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`
            }
          >
            <item.icon className="w-4.5 h-4.5" />
            {item.label}
          </NavLink>
        ))}
        <div className="px-3 pt-2">
          <p className="text-[10px] text-muted-foreground/60">v0.1.0</p>
        </div>
      </div>
    </aside>
  );
}
