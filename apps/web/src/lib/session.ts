import { useQuery } from '@tanstack/react-query';
import type { StudentMeDto, TeacherDto } from '@infoklas/shared';
import { ApiError, api } from './api';

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function useTeacher() {
  return useQuery({
    queryKey: ['teacher-me'],
    queryFn: () => orNull(api.get<TeacherDto>('/api/auth/me')),
    staleTime: 5 * 60_000,
  });
}

export function useStudent() {
  return useQuery({
    queryKey: ['student-me'],
    queryFn: () => orNull(api.get<StudentMeDto>('/api/student/me')),
    staleTime: 5 * 60_000,
  });
}
