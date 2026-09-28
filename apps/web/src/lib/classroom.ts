/** Google Classroom "share" link: opens Classroom with the link attached to a new post. */
export function classroomShareUrl(url: string, title: string): string {
  const params = new URLSearchParams({ url, title });
  return `https://classroom.google.com/share?${params.toString()}`;
}

export function assignmentLink(joinCode: string, assignmentId: string): string {
  return `${window.location.origin}/join/${joinCode}?next=${encodeURIComponent(`/s/a/${assignmentId}`)}`;
}
