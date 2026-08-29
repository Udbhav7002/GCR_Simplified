import type { MatchedFragment } from "@/lib/types";

interface FragmentDiffProps {
  fragment: MatchedFragment;
  studentAName: string;
  studentBName: string;
}

export function FragmentDiff({ fragment, studentAName, studentBName }: FragmentDiffProps) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
        <div className="text-xs text-muted-foreground mb-1 font-semibold">{studentAName}</div>
        <div>{fragment.text_a}</div>
      </div>
      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
        <div className="text-xs text-muted-foreground mb-1 font-semibold">{studentBName}</div>
        <div>{fragment.text_b}</div>
      </div>
    </div>
  );
}
