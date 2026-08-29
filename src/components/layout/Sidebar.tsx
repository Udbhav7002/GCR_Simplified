import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Settings, BookOpen, ListChecks, HelpCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isOnboardingDismissed, ONBOARDING_CHANGED_EVENT } from "@/lib/onboarding";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/courses", icon: BookOpen, label: "Courses" },
];

const bottomItems = [
  { to: "/onboarding", icon: ListChecks, label: "Setup Guide" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const [appVersion, setAppVersion] = useState<string>("v0.1.1");
  const [showSetup, setShowSetup] = useState(() => !isOnboardingDismissed());

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(`v${v}`))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setShowSetup(!isOnboardingDismissed());
    window.addEventListener(ONBOARDING_CHANGED_EVENT, sync);
    return () => window.removeEventListener(ONBOARDING_CHANGED_EVENT, sync);
  }, []);

  const handleReportIssue = () => {
    const issueUrl = `https://github.com/Udbhav7002/GCR_Simplified/issues/new?title=[Bug]%20&body=**App%20Version:**%20${encodeURIComponent(
      appVersion
    )}%0A**OS:**%20${encodeURIComponent(navigator.userAgent)}%0A%0A**Describe%20the%20issue:**%0A`;
    openUrl(issueUrl).catch(() => window.open(issueUrl, "_blank"));
  };

  return (
    <aside id="tour-sidebar" className="flex flex-col w-64 border-r border-border bg-card h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground shadow-sm">
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
                isActive
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
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
        {bottomItems
          .filter((item) => item.to !== "/onboarding" || showSetup)
          .map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`
            }
          >
            <item.icon className="w-4.5 h-4.5" />
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={handleReportIssue}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer text-left"
        >
          <HelpCircle className="w-4.5 h-4.5" />
          Report Issue
        </button>
        <div className="px-3 pt-2">
          <p className="text-[10px] text-muted-foreground/60">{appVersion}</p>
        </div>
      </div>
    </aside>
  );
}
