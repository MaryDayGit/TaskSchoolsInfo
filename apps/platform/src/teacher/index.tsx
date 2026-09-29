import { TeacherGate } from './TeacherGate';
import { TeacherHome } from './TeacherHome';

/** Кабинет учителя грузится отдельной частью: страница ученика на слабых ПК легче. */
export default function TeacherApp() {
  return (
    <TeacherGate>
      <TeacherHome />
    </TeacherGate>
  );
}
