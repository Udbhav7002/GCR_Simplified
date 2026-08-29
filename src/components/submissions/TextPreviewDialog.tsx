import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface TextPreviewDialogProps {
  viewingText: { studentName: string; text: string; method: string } | null;
  onClose: () => void;
}

export function TextPreviewDialog({ viewingText, onClose }: TextPreviewDialogProps) {
  if (!viewingText) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{viewingText.studentName}</h3>
            <p className="text-xs text-muted-foreground">Extracted via {viewingText.method}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 font-mono text-sm whitespace-pre-wrap bg-muted/20">
          {viewingText.text || "No text content found."}
        </div>
      </Card>
    </div>
  );
}
