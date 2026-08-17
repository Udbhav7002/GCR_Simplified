import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/courses": "Google Classroom",
  "/settings": "Settings",
};

interface HeaderProps {
  onNewAssignment?: () => void;
}

export function Header({ onNewAssignment }: HeaderProps) {
  const location = useLocation();
  const pathBase = "/" + (location.pathname.split("/")[1] || "");
  const title = pageTitles[pathBase] || "GCR Simplified";

  return (
    <header className="flex items-center justify-between px-8 py-5 border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {location.pathname === "/" && "Overview of your synced courses and assignments"}
          {pathBase === "/courses" && "Manage Google Classroom sync"}
          {pathBase === "/settings" && "Configure app preferences and API keys"}
        </p>
      </div>
      {location.pathname === "/" && onNewAssignment && (
        <Button onClick={onNewAssignment} className="gap-2" size="sm">
          <Plus className="w-4 h-4" />
          New Course
        </Button>
      )}
    </header>
  );
}
