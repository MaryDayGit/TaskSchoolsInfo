import { useNavigate } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { Modal } from '../components/Modal';

const WAYS: { icon: IconName; title: string; text: string; to: string }[] = [
  {
    icon: 'edit',
    title: 'Написати самостійно',
    text: 'Питання з варіантами або з відповіддю словом — по одному, у редакторі.',
    to: '/t/quizzes/new',
  },
  {
    icon: 'upload',
    title: 'Вставити готовий текст',
    text: 'Скопіюйте тест з Word або Клас-пульта: «*» перед правильною відповіддю.',
    to: '/t/quizzes?import=1',
  },
  {
    icon: 'book',
    title: 'Взяти шаблон НУШ',
    text: 'Готові тести для 2–9 класів: створиться копія, яку можна змінити.',
    to: '/t/quizzes?templates=1',
  },
];

/** «Створити тест»: three ways, one tap each. */
export function CreateTestModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Modal title="Як створити тест?" onClose={onClose}>
      <div className="stack">
        {WAYS.map((w) => (
          <button
            key={w.title}
            type="button"
            className="choice"
            onClick={() => {
              onClose();
              navigate(w.to);
            }}
          >
            <span className="choice-icon">
              <Icon name={w.icon} size={24} />
            </span>
            <span className="choice-text">
              <span className="choice-title">{w.title}</span>
              <span className="choice-note">{w.text}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
