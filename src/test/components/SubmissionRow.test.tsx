import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SubmissionRow } from "@/components/submissions/SubmissionRow";
import type { GoogleSubmission } from "@/lib/types";

const renderInTable = (ui: React.ReactElement) => {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
};

describe("SubmissionRow", () => {
  const mockSub: GoogleSubmission = {
    id: "sub1",
    course_id: "course1",
    course_work_id: "cw1",
    user_id: "s1",
    student_name: "Bob Builder",
    student_email: "bob@example.com",
    state: "TURNED_IN",
    late: false,
    assigned_grade: 95,
    attachments: [
      {
        drive_file_id: "file1",
        drive_file_title: "assignment.pdf",
      },
    ],
  };

  it("renders submission details, status badge, and calls onDownload", () => {
    const onDownload = vi.fn();
    const onViewText = vi.fn();

    renderInTable(
      <SubmissionRow
        sub={mockSub}
        downloadingItems={{}}
        extractionResult={undefined}
        onDownload={onDownload}
        onViewText={onViewText}
      />
    );

    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    expect(screen.getByText("Turned In")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();

    // Check file download button
    const fileTitle = screen.getByText("assignment.pdf");
    expect(fileTitle).toBeInTheDocument();

    const button = fileTitle.closest("button");
    expect(button).not.toBeNull();

    fireEvent.click(button!);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith(mockSub, mockSub.attachments[0]);
  });
});
