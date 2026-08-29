import { create } from "zustand";

export interface Course {
  id: string;
  name: string;
  section?: string;
}

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
}

interface AppStore {
  selectedCourse: Course | null;
  selectedAssignment: Assignment | null;
  gradingInProgress: boolean;
  setSelectedCourse: (course: Course | null) => void;
  setSelectedAssignment: (assignment: Assignment | null) => void;
  setGradingInProgress: (inProgress: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  selectedCourse: null,
  selectedAssignment: null,
  gradingInProgress: false,
  setSelectedCourse: (course) => set({ selectedCourse: course }),
  setSelectedAssignment: (assignment) => set({ selectedAssignment: assignment }),
  setGradingInProgress: (inProgress) => set({ gradingInProgress: inProgress }),
}));
