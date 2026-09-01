import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listGoogleCourses,
  listGoogleCoursework,
  listGoogleStudents,
  listGoogleSubmissions,
  getMissingSubmissions,
} from "@/lib/ipc";
import { friendlyError } from "@/components/ui/toaster";

export function useCourses() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["courses"],
    queryFn: () => listGoogleCourses(false),
  });

  const sync = useMutation({
    mutationFn: () => listGoogleCourses(true),
    onSuccess: (data) => {
      queryClient.setQueryData(["courses"], data);
    },
  });

  return {
    ...query,
    errorMsg: query.error ? friendlyError(query.error) : null,
    sync: sync.mutateAsync,
    isSyncing: sync.isPending,
  };
}

export function useCoursework(courseId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["coursework", courseId],
    queryFn: () => listGoogleCoursework(courseId, false),
    enabled: !!courseId,
  });

  const sync = useMutation({
    mutationFn: () => listGoogleCoursework(courseId, true),
    onSuccess: (data) => {
      queryClient.setQueryData(["coursework", courseId], data);
    },
  });

  return {
    ...query,
    errorMsg: query.error ? friendlyError(query.error) : null,
    sync: sync.mutateAsync,
    isSyncing: sync.isPending,
  };
}

export function useStudents(courseId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["students", courseId],
    queryFn: () => listGoogleStudents(courseId, false),
    enabled: !!courseId,
  });

  const sync = useMutation({
    mutationFn: () => listGoogleStudents(courseId, true),
    onSuccess: (data) => {
      queryClient.setQueryData(["students", courseId], data);
    },
  });

  return {
    ...query,
    errorMsg: query.error ? friendlyError(query.error) : null,
    sync: sync.mutateAsync,
    isSyncing: sync.isPending,
  };
}

export function useSubmissions(courseId: string, courseWorkId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["submissions", courseId, courseWorkId],
    queryFn: () => listGoogleSubmissions(courseId, courseWorkId, false),
    enabled: !!courseId && !!courseWorkId,
  });

  const sync = useMutation({
    mutationFn: () => listGoogleSubmissions(courseId, courseWorkId, true),
    onSuccess: (data) => {
      queryClient.setQueryData(["submissions", courseId, courseWorkId], data);
    },
  });

  return {
    ...query,
    errorMsg: query.error ? friendlyError(query.error) : null,
    sync: sync.mutateAsync,
    isSyncing: sync.isPending,
  };
}

export function useMissingSubmissions(courseId: string, courseWorkId: string) {
  const query = useQuery({
    queryKey: ["missing_submissions", courseId, courseWorkId],
    queryFn: () => getMissingSubmissions(courseId, courseWorkId),
    enabled: !!courseId && !!courseWorkId,
  });

  return {
    ...query,
    errorMsg: query.error ? friendlyError(query.error) : null,
  };
}

export function useDashboardStats() {
  const query = useQuery({
    queryKey: ["dashboard_stats"],
    queryFn: () => import("@/lib/ipc").then(m => m.getDashboardStats()),
  });
  return query;
}

export function useAuthStatus() {
  const query = useQuery({
    queryKey: ["auth_status"],
    queryFn: () => import("@/lib/ipc").then(m => m.getGoogleAuthStatus()),
  });
  return query;
}
