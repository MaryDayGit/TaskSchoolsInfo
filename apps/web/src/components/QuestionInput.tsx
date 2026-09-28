import type { AnswerValue, PublicQuestion } from '@infoklas/shared';
import { OPTION_SHAPES, optionStyle } from './options';

/** Answer input for one question; used both in homework and in live games. */
export function QuestionInput({
  question,
  value,
  onChange,
  disabled,
  onSubmitText,
}: {
  question: PublicQuestion;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  disabled?: boolean;
  onSubmitText?: () => void;
}) {
  if (question.type === 'text') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmitText?.();
        }}
      >
        <input
          className="input"
          style={{ fontSize: '1.3rem', minHeight: 56 }}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Напиши відповідь…"
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={500}
          aria-label="Відповідь"
        />
      </form>
    );
  }

  const selected = question.type === 'single' ? [value] : Array.isArray(value) ? value : [];
  const toggle = (id: string) => {
    if (question.type === 'single') return onChange(id);
    const cur = Array.isArray(value) ? value : [];
    onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  return (
    <div>
      {question.type === 'multiple' && (
        <p className="muted" style={{ fontWeight: 700 }}>
          Обери всі правильні відповіді
        </p>
      )}
      <div className="options" role={question.type === 'single' ? 'radiogroup' : 'group'}>
        {question.options.map((o, i) => {
          const isSel = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`option-btn${isSel ? ' selected' : ''}`}
              style={optionStyle(i)}
              onClick={() => toggle(o.id)}
              disabled={disabled}
              role={question.type === 'single' ? 'radio' : 'checkbox'}
              aria-checked={isSel}
            >
              <span className="option-shape" aria-hidden>
                {OPTION_SHAPES[i % OPTION_SHAPES.length]}
              </span>
              <span>{o.text}</span>
              {isSel && (
                <span className="option-check" aria-hidden>
                  ✔
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function hasAnswer(v: AnswerValue | undefined): boolean {
  if (v === undefined) return false;
  return Array.isArray(v) ? v.length > 0 : v.trim().length > 0;
}
