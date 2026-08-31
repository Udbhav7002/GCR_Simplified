import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { GradebookRow } from "@/components/gradebook/GradebookRow";
import type { GradebookRow as GradebookRowType, GradebookView } from "@/lib/types";

// Setup for Table context, as TableRow needs a table and tbody parent
const renderInTable = (ui: React.ReactElement) => {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
};

describe("GradebookRow", () => {
  const mockRubric: GradebookView["rubric"] = [
    { id: "c1", assignment_id: "a1", name: "Grammar", description: "", max_marks: 10, sort_order: 1 },
  ];

  const mockRow: GradebookRowType = {
    submission_id: "sub1",
    student_id: "s1",
    student_name: "Alice Liddell",
    student_email: "alice@example.com",
    roll_number: "RL01",
    file_reg_no: null,
    file_name_hint: null,
    ai_feedback: null,
    grading_status: "graded",
    ai_total_score: 8,
    graded_via: "text",
    grades: [
      {
        id: "g1",
        submission_id: "sub1",
        criterion_id: "c1",
        score: 8,
        feedback: "Good",
        justification: null,
        graded_by: "teacher",
        approved: true,
        graded_at: "2024-01-01T00:00:00Z",
      },
    ],
  };

  it("renders student name, grades, and edit button", () => {
    const onEditGrade = vi.fn();
    const onApproveGrade = vi.fn();

    renderInTable(
      <GradebookRow row={mockRow} rubric={mockRubric} onEditGrade={onEditGrade} onApproveGrade={onApproveGrade} />
    );

    // Should render name
    expect(screen.getByText("Alice Liddell")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();

    // Should render grade
    expect(screen.getByText("8")).toBeInTheDocument();

    // Should render edit button and respond to click
    const editButton = screen.getByLabelText(/Edit grade for Alice Liddell/i);
    expect(editButton).toBeInTheDocument();

    fireEvent.click(editButton);
    expect(onEditGrade).toHaveBeenCalledTimes(1);
    expect(onEditGrade).toHaveBeenCalledWith(mockRow.grades[0], mockRow);
  });
});
