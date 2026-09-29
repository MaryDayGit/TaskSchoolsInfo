/** Ошибка Firebase → понятный текст на украинском (из Клас-пульта). */
export function errorText(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = String(e?.code ?? '').replace(/^(auth|firestore)\//, '');
  switch (code) {
    case 'permission-denied':
      return 'Немає доступу до бази. Перевірте, що правила опубліковано (firebase deploy).';
    case 'unavailable':
    case 'network-request-failed':
      return "Немає зв'язку з сервером. Перевірте інтернет.";
    case 'too-many-requests':
      return 'Забагато спроб. Зачекайте кілька хвилин.';
    case 'operation-not-allowed':
    case 'admin-restricted-operation':
      return 'Анонімний вхід вимкнено в налаштуваннях Firebase (Authentication → Sign-in method → Anonymous).';
    case 'resource-exhausted':
      return 'Вичерпано безкоштовний ліміт Firebase на сьогодні.';
    default:
      return 'Помилка: ' + (e?.message || e?.code || 'невідома');
  }
}

export function isPermissionDenied(err: unknown): boolean {
  return String((err as { code?: string } | null)?.code ?? '').endsWith('permission-denied');
}
