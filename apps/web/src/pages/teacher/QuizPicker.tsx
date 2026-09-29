import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { QuizSummaryDto } from '@infoklas/shared';
import { Field, QueryState } from '../../components/ui';
import { api } from '../../lib/api';
import { countLabel } from '../../lib/format';

export function QuizPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const quizzes = useQuery({
    queryKey: ['quizzes'],
    queryFn: () => api.get<QuizSummaryDto[]>('/api/quizzes'),
  });
  return (
    <QueryState query={quizzes}>
      {(list) => {
        const usable = list.filter((q) => q.questionCount > 0);
        return usable.length === 0 ? (
          <div className="alert alert-info">
            Спочатку створіть тест з питаннями. <Link to="/t/quizzes/new">Створити тест →</Link>
          </div>
        ) : (
          <Field label="Тест">
            <select
              className="select"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              required
            >
              <option value="" disabled>
                Оберіть тест…
              </option>
              {usable.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title} ({countLabel(q.questionCount, ['питання', 'питання', 'питань'])})
                </option>
              ))}
            </select>
          </Field>
        );
      }}
    </QueryState>
  );
}
