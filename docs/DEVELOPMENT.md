# Руководство разработчика

## Требования

- **Node.js 22.22+** (версия указана в `.nvmrc`)
- **PostgreSQL 14+**: свой или в Docker
- Для тестов база не нужна: они используют встроенный PGlite

## Первый запуск

```bash
npm install
cp .env.example .env
docker run -d --name infoklas-db -p 5432:5432 \
  -e POSTGRES_USER=infoklas -e POSTGRES_PASSWORD=infoklas -e POSTGRES_DB=infoklas postgres:16-alpine
npm run dev
```

- Интерфейс: http://localhost:5173. Vite проксирует `/api` и `/socket.io` на сервер.
- Сервер: http://localhost:3000. Перезапускается при изменениях (`tsx watch`).
- Миграции применяются при старте сервера.

Чтобы проверить интерфейс с телефона в той же Wi‑Fi сети, откройте `http://<IP-компьютера>:5173`: Vite слушает все интерфейсы.

## Команды

| Команда                            | Описание                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                      | сервер + интерфейс в режиме разработки                             |
| `npm test`                         | все тесты (Vitest)                                                 |
| `npx vitest run --project server`  | только тесты сервера (или `--project shared`)                      |
| `npx vitest --project server live` | тесты по имени файла в watch-режиме                                |
| `npm run lint`                     | ESLint                                                             |
| `npm run format` / `format:check`  | Prettier                                                           |
| `npm run typecheck`                | TypeScript во всех пакетах                                         |
| `npm run check`                    | всё вместе, как в CI                                               |
| `npm run build`                    | сборка интерфейса (`apps/web/dist`) и сервера (`apps/server/dist`) |
| `npm start`                        | запуск собранного сервера                                          |
| `npm run db:generate`              | создать миграцию по изменениям схемы                               |

Запуск продакшен-сборки локально:

```bash
npm run build
cd apps/server && WEB_DIST_DIR=../web/dist node --env-file=../../.env dist/index.js
# → http://localhost:3000
```

## Структура

Подробно в [ARCHITECTURE.md](ARCHITECTURE.md). Коротко:

```
packages/shared/src   quiz.ts (вопросы, проверка), api.ts (DTO и схемы запросов),
                      live.ts (события игры), pictures.ts, grades.ts
apps/server/src       app.ts, routes/, live/, db/, lib/, test/
apps/server/drizzle   SQL-миграции (генерируются, руками не правятся)
apps/web/src          pages/{public,teacher,student}, components/, lib/, styles.css
```

## Соглашения

- **TypeScript strict** с `noUncheckedIndexedAccess`. Типы импортируются через `import type`: это проверяет ESLint.
- **Весь текст интерфейса и сообщения об ошибках API на украинском.** Код, комментарии и коммиты на английском.
- **Валидация входных данных только через Zod-схемы** из `shared`. Если схема нужна и форме, и серверу, она живёт в `shared/src/api.ts`.
- **Доступ к ресурсам учителя** только через хелперы `lib/access.ts` (`getOwnedClass` и др.): они возвращают 404 для чужого.
- **Ошибки** бросаются как `HttpError` / `notFound()` / `badRequest()` / `conflict()`. Ответ формирует общий обработчик.
- **Стили:** обычный CSS с переменными из `:root` в `styles.css`. Новые цвета заводятся как переменные.
- **Данные на клиенте:** TanStack Query. После изменения данных инвалидируйте связанные ключи (`['classes']`, `['students', classId]`, `['journal', classId]` …).
- Форматирование (Prettier): одинарные кавычки, ширина 100.

## База данных и миграции

1. Измените `apps/server/src/db/schema.ts`.
2. `npm run db:generate -w @infoklas/server -- --name short_description`.
3. Проверьте SQL в `apps/server/drizzle/NNNN_*.sql` и закоммитьте его вместе с `meta/`.
4. Миграция применится при следующем запуске сервера, и в тестах тоже.

Уже применённые миграции не редактируйте: создавайте новую.

## Тесты

- Каждый серверный тест создаёт свою базу PGlite в памяти и прогоняет миграции, поэтому тесты независимы.
- `test/helpers.ts`:
  - `createTestApp(overrides)`: приложение и база;
  - `Agent`: HTTP-клиент поверх `fastify.inject`, который сохраняет cookie между запросами;
  - `registerTeacher(app)`: новый учитель, уже вошедший в систему;
  - `sampleQuestions`: по одному вопросу каждого типа.
- Тесты игр поднимают сервер на случайном порту и подключают клиентов `socket.io-client`. Хелпер `client(agent).waitFor(pred)` ждёт нужного состояния.

Пример:

```ts
it('creates a class', async () => {
  const t = await registerTeacher(ctx.app);
  const res = await t.post('/api/classes', { name: '5-А', grade: 5 });
  expect(res.statusCode).toBe(200);
});
```

## Как добавить новый тип вопроса

1. `shared/src/quiz.ts`: схема в `questionSchema`, ветки в `toPublicQuestion`, `isAnswerCorrect`, `describeCorrectAnswer`, тип `PublicQuestion`. Добавьте модульные тесты в `quiz.test.ts`.
2. `web/src/components/QuestionInput.tsx`: как ученик отвечает.
3. `web/src/pages/teacher/QuizEditor.tsx`: название в `TYPE_LABELS`, `newQuestion`, `changeType`, редактор полей.
4. `web/src/pages/teacher/LiveHost.tsx`: отображение на проекторе. На сервере `live/manager.ts`: статистика при `reveal`.

Миграция не нужна: вопросы хранятся в jsonb.

## Как добавить новый модуль (например, «Робот на поле»)

Рекомендуемый путь, чтобы модуль встроился в задания и журнал:

1. Новые таблицы в `schema.ts` (уровни, попытки) и миграция.
2. Маршруты в `routes/<module>.ts`, регистрация в `app.ts`. Для доступа используйте `getOwnedClass` и `loadStudent`.
3. Колонки в журнале: расширьте `buildJournal` в `routes/classes.ts` и `JournalColumnDto.kind`.
4. Страницы в `web/src/pages/...`, маршруты в `App.tsx`. Страницы учителя добавляйте в ленивый `pages/teacher/index.ts`.
5. Тесты API в `apps/server/src/test/`.

## CI

`.github/workflows/ci.yml` на каждый push и PR запускает `npm ci` → lint → format:check → typecheck → test → build. Перед push запускайте `npm run check`.

## Частые проблемы

| Симптом                                                       | Решение                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration: DATABASE_URL is required` | нет `.env`: `cp .env.example .env`                                                                              |
| `JWT_SECRET must be at least 32 characters`                   | задайте длинный `JWT_SECRET`                                                                                    |
| `ECONNREFUSED 127.0.0.1:5432`                                 | не запущен Postgres                                                                                             |
| Живая игра не подключается в dev                              | сервер должен работать на порту из `API_URL` (по умолчанию 3000); проверьте, что открыт именно порт Vite (5173) |
| После изменения `schema.ts` ошибки SQL                        | забыли `npm run db:generate`                                                                                    |
