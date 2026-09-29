# API

REST API и события Socket.IO. Типы всех тел запросов и ответов описаны в `packages/shared/src/api.ts` и `packages/shared/src/live.ts`. Схемы валидации (Zod) лежат там же.

## Общие правила

- Базовый путь `/api`, формат JSON (`Content-Type: application/json`).
- Авторизация через cookie: `ik_teacher` для учителя, `ik_student` для ученика. Cookie ставятся при входе, их не нужно передавать вручную.
- Ошибка всегда возвращается как `{ "error": "Текст для пользователя (укр.)" }`. У ошибок валидации (400) есть ещё `details` со списком проблем Zod.
- Идентификаторы — UUID. Некорректный или чужой id возвращает `404`.

| Код | Когда                                                            |
| --- | ---------------------------------------------------------------- |
| 400 | неверные данные                                                  |
| 401 | не выполнен вход (или неверный пароль)                           |
| 403 | действие запрещено (например, регистрация закрыта)               |
| 404 | не найдено или нет доступа                                       |
| 409 | конфликт: дубликат имени, срок сдачи прошёл, попытки закончились |
| 429 | слишком много запросов или ученик временно заблокирован          |

## Служебное

| Метод | Путь          | Ответ            |
| ----- | ------------- | ---------------- |
| GET   | `/api/health` | `{ "ok": true }` |

## Учитель: вход

| Метод | Путь                 | Тело                        | Ответ                            | Примечания                                                                                      |
| ----- | -------------------- | --------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET   | `/api/auth/config`   |                             | `{ teacherSignupOpen: boolean }` |                                                                                                 |
| POST  | `/api/auth/register` | `{ email, name, password }` | `TeacherDto`                     | пароль ≥ 8 символов; 403, если регистрация закрыта; 409 при занятом email; 10 запросов в минуту |
| POST  | `/api/auth/login`    | `{ email, password }`       | `TeacherDto`                     | 401 при неверных данных; 10 запросов в минуту                                                   |
| POST  | `/api/auth/logout`   |                             | `{ ok: true }`                   |                                                                                                 |
| GET   | `/api/auth/me`       |                             | `TeacherDto`                     | 401 без входа                                                                                   |

`TeacherDto = { id, email, name }`

## Учитель: классы и ученики

| Метод  | Путь                               | Тело                         | Ответ                                                                            |
| ------ | ---------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/classes`                     |                              | `ClassDto[]` (по году обучения, затем по названию)                               |
| POST   | `/api/classes`                     | `{ name, grade }`            | `ClassDto`                                                                       |
| GET    | `/api/classes/:id`                 |                              | `ClassDto`                                                                       |
| PATCH  | `/api/classes/:id`                 | `{ name, grade }`            | `ClassDto`                                                                       |
| DELETE | `/api/classes/:id`                 |                              | `{ ok: true }` (каскадно удаляет всё, что относится к классу)                    |
| POST   | `/api/classes/:id/regenerate-code` |                              | `ClassDto` с новым `joinCode`                                                    |
| GET    | `/api/classes/:id/students`        |                              | `StudentDto[]`                                                                   |
| POST   | `/api/classes/:id/students`        | `{ names: string[] }` (1–60) | `StudentDto[]` (созданные); 409, если имя уже есть или учеников станет больше 60 |
| PATCH  | `/api/students/:id`                | `{ displayName }`            | `StudentDto`                                                                     |
| POST   | `/api/students/:id/reset-secret`   |                              | `StudentDto` с новым паролем, блокировка снимается                               |
| DELETE | `/api/students/:id`                |                              | `{ ok: true }`                                                                   |

```ts
ClassDto = { id, name, grade /* 2–9 */, joinCode /* "482158" */, studentCount, createdAt };
StudentDto = { id, displayName, secretKind: 'pictures' | 'password', secret };
// secret: "cat-sun-rocket" для картинок (id из PICTURES) или "ракета47"
```

## Учитель: тесты

| Метод  | Путь                         | Тело        | Ответ                                           |
| ------ | ---------------------------- | ----------- | ----------------------------------------------- |
| GET    | `/api/quizzes`               |             | `QuizSummaryDto[]` (сначала недавно изменённые) |
| POST   | `/api/quizzes`               | `QuizInput` | `QuizDto`                                       |
| GET    | `/api/quizzes/:id`           |             | `QuizDto`                                       |
| PUT    | `/api/quizzes/:id`           | `QuizInput` | `QuizDto`                                       |
| POST   | `/api/quizzes/:id/duplicate` |             | `QuizDto` (название с «(копія)»)                |
| DELETE | `/api/quizzes/:id`           |             | `{ ok: true }` (выданные задания сохраняются)   |

```ts
QuizInput      = { title, questions: Question[] }   // до 50 вопросов, формат см. ARCHITECTURE.md
QuizDto        = { id, title, questions, updatedAt }
QuizSummaryDto = { id, title, questionCount, updatedAt }
```

## Учитель: задания и результаты

| Метод  | Путь                           | Тело                                                      | Ответ                                           |
| ------ | ------------------------------ | --------------------------------------------------------- | ----------------------------------------------- |
| GET    | `/api/classes/:id/assignments` |                                                           | `AssignmentDto[]` (сначала новые)               |
| POST   | `/api/assignments`             | `{ quizId, classId, dueAt?, maxAttempts?, showCorrect? }` | `AssignmentDto`; 400, если в тесте нет вопросов |
| PATCH  | `/api/assignments/:id`         | `{ dueAt?, maxAttempts?, showCorrect? }`                  | `AssignmentDto`                                 |
| DELETE | `/api/assignments/:id`         |                                                           | `{ ok: true }`                                  |
| GET    | `/api/assignments/:id/results` |                                                           | `AssignmentResultsDto`                          |

- `dueAt`: ISO-дата с часовым поясом или `null` (без срока).
- `maxAttempts`: 1–20 или `null` (без ограничений). По умолчанию `null`.
- `showCorrect`: по умолчанию `true`.

```ts
AssignmentDto = { id, classId, title, questionCount, dueAt, maxAttempts, showCorrect, createdAt,
                  submittedCount /* сколько учеников сдали */ }
AssignmentResultsDto = {
  assignment: AssignmentDto,
  questions: Question[],                 // с правильными ответами
  rows: { studentId, displayName, attempts,
          best: { correctCount, total, submittedAt } | null,
          perQuestion: boolean[] | null }[]   // правильность по вопросам в лучшей попытке
}
```

## Учитель: журнал

| Метод | Путь                           | Ответ                                                        |
| ----- | ------------------------------ | ------------------------------------------------------------ |
| GET   | `/api/classes/:id/journal`     | `JournalDto`                                                 |
| GET   | `/api/classes/:id/journal.csv` | CSV-файл: UTF-8 с BOM, разделитель `;`, значения в процентах |

```ts
JournalDto = {
  students: { id, displayName }[],
  columns: { id, kind: 'assignment' | 'live', title, date }[],   // по дате
  cells: Record<`${studentId}:${columnId}`, { correctCount, total }>
}
```

Для заданий берётся лучшая попытка, для игр учитываются только завершённые (`finished`) игры.

## Учитель: живые игры

| Метод | Путь                    | Тело                  | Ответ                                                                                |
| ----- | ----------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| POST  | `/api/live`             | `{ quizId, classId }` | `LiveSessionDto`: создаёт игру в статусе `lobby`, предыдущая игра класса завершается |
| GET   | `/api/classes/:id/live` |                       | `LiveSessionDto[]` (последние 50)                                                    |

`LiveSessionDto = { id, classId, title, status: 'active' | 'finished' | 'aborted', createdAt }`

Дальше игра управляется через Socket.IO (см. ниже).

## Ученик

| Метод | Путь                                  | Тело                                                | Ответ                           | Примечания                                                    |
| ----- | ------------------------------------- | --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| GET   | `/api/join/:code`                     |                                                     | `ClassPublicDto`                | 404 при неверном коде; 60 запросов в минуту                   |
| POST  | `/api/student/login`                  | `{ classCode, studentId, secret }`                  | `StudentMeDto`                  | 401 при неверном пароле; 429 при блокировке (5 ошибок → 60 с) |
| POST  | `/api/student/logout`                 |                                                     | `{ ok: true }`                  |                                                               |
| GET   | `/api/student/me`                     |                                                     | `StudentMeDto`                  |                                                               |
| GET   | `/api/student/assignments`            |                                                     | `StudentAssignmentSummaryDto[]` |                                                               |
| GET   | `/api/student/assignments/:id`        |                                                     | `StudentAssignmentDto`          | вопросы без правильных ответов                                |
| POST  | `/api/student/assignments/:id/submit` | `{ answers: { [questionId]: string \| string[] } }` | `SubmissionResultDto`           | 409, если срок прошёл или попытки закончились                 |
| GET   | `/api/student/assignments/:id/result` |                                                     | `SubmissionResultDto \| null`   | последняя попытка                                             |
| GET   | `/api/student/live`                   |                                                     | `{ id, title } \| null`         | идёт ли сейчас игра в классе                                  |

```ts
ClassPublicDto = { name, grade, junior, students: { id, displayName }[] }
StudentMeDto   = { id, displayName, classId, className, grade, junior }
StudentAssignmentSummaryDto = { id, title, questionCount, dueAt, maxAttempts, attemptsUsed,
                                best: { correctCount, total } | null, closed }
StudentAssignmentDto = StudentAssignmentSummaryDto & { questions: PublicQuestion[] }
SubmissionResultDto  = { attempt, correctCount, total,
  perQuestion: { questionId, correct, given, correctAnswer? }[] }  // correctAnswer только при showCorrect
```

Ответы на вопросы, которых нет в задании, при сохранении отбрасываются. Пропущенный вопрос считается неверным.

## Socket.IO: живая игра

Подключение: `io({ path: '/socket.io' })` с того же домена. Роль определяется cookie. Каждое событие клиента принимает callback-подтверждение `{ ok: boolean, error?: string }`.

### Клиент → сервер

| Событие       | Кто                 | Данные                                | Действие                                          |
| ------------- | ------------------- | ------------------------------------- | ------------------------------------------------- |
| `live:host`   | учитель-владелец    | `{ sessionId }`                       | подключиться как ведущий                          |
| `live:join`   | ученик этого класса | `{ sessionId }`                       | присоединиться как игрок (можно во время игры)    |
| `live:start`  | ведущий             | `{ sessionId }`                       | `lobby → question` (первый вопрос)                |
| `live:reveal` | ведущий             | `{ sessionId }`                       | показать ответ досрочно                           |
| `live:next`   | ведущий             | `{ sessionId }`                       | следующий вопрос или итоги после последнего       |
| `live:end`    | ведущий             | `{ sessionId }`                       | завершить игру и сохранить результаты             |
| `live:answer` | игрок               | `{ sessionId, questionIndex, value }` | ответить; один раз на вопрос, до дедлайна + 1,5 с |

После переподключения клиент должен снова отправить `live:host` или `live:join`. Хук `useLive` делает это автоматически.

### Сервер → клиент

`live:state` — полный снимок состояния для роли получателя. Отправляется при каждом изменении.

```ts
// общее
{ sessionId, title, status: 'lobby' | 'question' | 'reveal' | 'finished',
  questionIndex, questionCount, deadline /* ms или null */, serverNow, junior, showLeaderboard }

// ведущий (role: 'host')
+ { classId, className, joinCode, question /* с ответом */,
    participants: { studentId, name, connected, score, answered }[],
    answeredCount, optionStats /* при reveal */, textAnswers /* при reveal */, leaderboard }

// игрок (role: 'player')
+ { name, question /* PublicQuestion */, myAnswer,
    myResult: { correct, points, correctAnswer } | null /* при reveal */,
    myScore, myCorrectCount, leaderboard /* 5–9 класс */, myPlace /* 5–9 класс */ }
```
