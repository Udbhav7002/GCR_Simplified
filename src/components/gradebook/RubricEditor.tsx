import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useRubricMutations } from "@/hooks/useGradebookData";
import { useToast } from "@/components/ui/toaster";
import type { RubricCriterion } from "@/lib/types";
import { motion } from "framer-motion";

interface RubricEditorProps {
  assignmentId?: string;
  rubric: RubricCriterion[];
}

export function RubricEditor({ assignmentId, rubric }: RubricEditorProps) {
  const [newCriterionName, setNewCriterionName] = useState("");
  const [newCriterionMax, setNewCriterionMax] = useState("10");
  const { addCriterion, deleteCriterion } = useRubricMutations(assignmentId);
  const toast = useToast();

  const handleAdd = () => {
    const name = newCriterionName.trim();
    const maxMarks = parseFloat(newCriterionMax);
    if (!name) return toast("Please enter a criterion name.", "error");
    if (isNaN(maxMarks) || maxMarks <= 0) return toast("Max marks must be a positive number.", "error");

    addCriterion.mutate(
      { name, maxMarks, sortOrder: rubric.length + 1 },
      {
        onSuccess: () => {
          setNewCriterionName("");
          setNewCriterionMax("10");
        },
      }
    );
  };

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold mb-4">Rubric</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {rubric.map((crit) => (
          <motion.div
            key={crit.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-xl border bg-card flex justify-between items-start group shadow-sm"
          >
            <div>
              <h4 className="font-medium text-sm text-foreground">{crit.name}</h4>
              <p className="text-xs text-muted-foreground mt-1">Max marks: {crit.max_marks}</p>
            </div>
            {rubric.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteCriterion.mutate(crit.id)}
                disabled={deleteCriterion.isPending}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </motion.div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Input
          placeholder="Criterion name (e.g. Code Clarity)"
          value={newCriterionName}
          onChange={(e) => setNewCriterionName(e.target.value)}
          className="max-w-xs"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min="1"
            value={newCriterionMax}
            onChange={(e) => setNewCriterionMax(e.target.value)}
            className="w-24"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button 
            onClick={handleAdd} 
            disabled={addCriterion.isPending} 
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4" />
            Add Criterion
          </Button>
        </div>
      </div>
    </div>
  );
}
