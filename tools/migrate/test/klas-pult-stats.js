// Копия public/stats.js из репозитория klas-pult (коммит d3f4eac) без изменений:
// тесты переноса сверяют баллы с настоящим кодом Клас-пульта.
/*
 * Клас-пульт — статистика тестов (пульт учителя).
 *
 * Чистые функции поверх сессии и ответов учеников, общие для блока
 * «Результати» на уроке и вкладки «Історія»:
 *   App.Stats.compute(session, results)  — баллы, распределение, статистика по вопросам
 *   App.Stats.table / tiles / distribution / questions — элементы для показа
 *   App.Stats.downloadCsv(...)            — выгрузка для Excel
 *
 * Сессия — sessions/{resetAt_testId}: один тест в одном классе. В ней снимок
 * вопросов (questions) и правильных ответов (answers) на момент отправки,
 * поэтому история не портится, если тест потом изменить или удалить.
 *
 * Графики — простые полосы одного цвета (величина), подписи — числами рядом,
 * правильный вариант отмечен значком и словом, а не только цветом.
 */
(function () {
  'use strict';

  const App = window.App;
  if (!App || !App.ok) return;

  const h = App.h;
  const MARK_TEXT = { ok: 'правильно', bad: 'неправильно', none: 'без відповіді' };

  function pcText(pcId, num) {
    return 'ПК ' + App.pcLabel(typeof num === 'number' && num > 0 ? num : App.pcNum(pcId) || 0);
  }

  function percent(part, whole) {
    return whole > 0 ? Math.round((part * 100) / whole) : 0;
  }

  /** Последняя попытка каждого ПК (по времени сдачи на сервере). */
  function latestAttempts(results) {
    const latest = {};
    results.forEach(function (r) {
      if (!r || typeof r.pc !== 'string') return;
      const prev = latest[r.pc];
      const time = App.toMillis(r.submittedAt);
      if (
        !prev ||
        time > App.toMillis(prev.submittedAt) ||
        (time === App.toMillis(prev.submittedAt) && r.sentAt > prev.sentAt)
      ) {
        latest[r.pc] = r;
      }
    });
    return Object.keys(latest).map(function (pc) {
      return latest[pc];
    });
  }

  /**
   * Всё, что показываем по сессии.
   *   rows          — по ученику: pc, num, name, score, marks ('ok'|'bad'|'none'), answers
   *   perQuestion   — по вопросу: text, options, counts (сколько выбрали каждый вариант),
   *                   none (без ответа), correct, correctIndex, percent
   *   distribution  — сколько учеников набрали 0, 1, … total баллов
   */
  function compute(session, results) {
    const key = session && Array.isArray(session.answers) ? session.answers : null;
    const questions = session && Array.isArray(session.questions) ? session.questions : [];
    const total = key ? key.length : questions.length;

    const rows = latestAttempts(results)
      .map(function (r) {
        const answers = Array.isArray(r.answers) ? r.answers : [];
        const marks = [];
        let score = 0;
        for (let i = 0; i < total; i++) {
          const a = typeof answers[i] === 'number' ? answers[i] : -1;
          let mark = 'none';
          if (a !== -1) mark = key && a === key[i] ? 'ok' : 'bad';
          if (mark === 'ok') score++;
          marks.push(mark);
        }
        return {
          pc: r.pc,
          num: typeof r.num === 'number' ? r.num : App.pcNum(r.pc) || 0,
          name: String(r.name || ''),
          score: key ? score : null,
          marks: marks,
          answers: answers,
        };
      })
      .sort(function (a, b) {
        return a.num - b.num;
      });

    const perQuestion = [];
    for (let i = 0; i < total; i++) {
      const q = questions[i] || {};
      const options = Array.isArray(q.options) ? q.options : [];
      const counts = options.map(function () {
        return 0;
      });
      let none = 0;
      let correct = 0;
      rows.forEach(function (row) {
        const a = typeof row.answers[i] === 'number' ? row.answers[i] : -1;
        if (a >= 0 && a < counts.length) counts[a]++;
        else none++;
        if (row.marks[i] === 'ok') correct++;
      });
      perQuestion.push({
        index: i,
        text: String(q.text || ''),
        options: options,
        counts: counts,
        none: none,
        correct: correct,
        correctIndex: key ? key[i] : -1,
        percent: percent(correct, rows.length),
      });
    }

    const distribution = [];
    for (let s = 0; s <= total; s++) distribution.push(0);
    let sum = 0;
    rows.forEach(function (row) {
      if (row.score === null) return;
      distribution[row.score]++;
      sum += row.score;
    });
    const avg = rows.length && key ? sum / rows.length : 0;

    let hardest = null;
    if (rows.length && key) {
      perQuestion.forEach(function (q) {
        if (!hardest || q.percent < hardest.percent) hardest = q;
      });
    }

    return {
      total: total,
      hasKey: !!key,
      rows: rows,
      submitted: rows.length,
      avg: avg,
      avgPercent: percent(avg, total),
      distribution: distribution,
      perQuestion: perQuestion,
      hardest: hardest,
    };
  }

  /** Короткая сводка для списка истории: сохраняется в sessions/{id}.summary. */
  function summary(stats) {
    return { submitted: stats.submitted, avgPercent: stats.avgPercent };
  }

  // ---------- Отображение ----------

  function avgText(stats) {
    return (Math.round(stats.avg * 10) / 10).toString().replace('.', ',');
  }

  /** Таблица учеников: ПК, имя, балл, квадратики по вопросам. */
  function table(stats, id) {
    return h('table', { id: id, class: 'results-table' }, [
      h(
        'thead',
        null,
        h('tr', null, [
          h('th', { scope: 'col', text: 'ПК' }),
          h('th', { scope: 'col', text: 'Учень' }),
          h('th', { scope: 'col', text: 'Бал' }),
          h('th', { scope: 'col', text: 'Відповіді' }),
        ]),
      ),
      h(
        'tbody',
        null,
        stats.rows.map(function (row) {
          return h('tr', null, [
            h('td', { class: 'r-pc', text: pcText(row.pc, row.num) }),
            h('td', { class: 'r-name', text: row.name }),
            h('td', {
              class: 'r-score',
              text: (row.score === null ? '?' : row.score) + ' / ' + stats.total,
            }),
            h(
              'td',
              { class: 'r-marks' },
              row.marks.map(function (mark, i) {
                const label = 'Питання ' + (i + 1) + ': ' + MARK_TEXT[mark];
                return h('span', {
                  class: 'sq ' + mark,
                  title: label,
                  'aria-label': label,
                  role: 'img',
                });
              }),
            ),
          ]);
        }),
      ),
    ]);
  }

  /** Крупные цифры: здали, средний балл, самый трудный вопрос. */
  function tiles(stats) {
    const items = [
      ['Здали', String(stats.submitted), App.plural(stats.submitted, 'учень', 'учні', 'учнів')],
      [
        'Середній бал',
        stats.hasKey ? avgText(stats) + ' з ' + stats.total : '—',
        stats.hasKey ? stats.avgPercent + '%' : '',
      ],
    ];
    if (stats.hardest) {
      items.push([
        'Найважче питання',
        '№ ' + (stats.hardest.index + 1),
        stats.hardest.percent + '% правильно',
      ]);
    }
    return h(
      'div',
      { class: 'stat-tiles' },
      items.map(function (item) {
        return h('div', { class: 'stat-tile' }, [
          h('p', { class: 'stat-label', text: item[0] }),
          h('p', { class: 'stat-value', text: item[1] }),
          item[2] ? h('p', { class: 'stat-note', text: item[2] }) : null,
        ]);
      }),
    );
  }

  /** Распределение баллов: столбик на каждый балл 0…total (при > 20 вопросах — по 10%). */
  function distribution(stats) {
    let bins = stats.distribution.map(function (count, score) {
      return {
        label: String(score),
        count: count,
        title: score + ' ' + App.plural(score, 'бал', 'бали', 'балів'),
      };
    });
    if (stats.total > 20) {
      const grouped = [];
      for (let b = 0; b < 10; b++) {
        grouped.push({
          label: b * 10 + '–' + (b === 9 ? 100 : b * 10 + 9) + '%',
          count: 0,
          title: '',
        });
      }
      stats.rows.forEach(function (row) {
        if (row.score === null) return;
        const p = percent(row.score, stats.total);
        grouped[Math.min(9, Math.floor(p / 10))].count++;
      });
      bins = grouped.map(function (bin) {
        bin.title = bin.label;
        return bin;
      });
    }
    const max = Math.max.apply(
      null,
      bins
        .map(function (b) {
          return b.count;
        })
        .concat([1]),
    );
    return h(
      'div',
      { class: 'dist', role: 'img', 'aria-label': 'Розподіл балів' },
      bins.map(function (bin) {
        const label =
          bin.title + ': ' + bin.count + ' ' + App.plural(bin.count, 'учень', 'учні', 'учнів');
        return h('div', { class: 'dist-col', title: label }, [
          h('span', { class: 'dist-count', text: bin.count ? String(bin.count) : '' }),
          h(
            'span',
            { class: 'dist-track' },
            h('span', {
              class: 'dist-bar',
              style: 'height: ' + Math.round((bin.count * 100) / max) + '%',
            }),
          ),
          h('span', { class: 'dist-label', text: bin.label }),
        ]);
      }),
    );
  }

  /**
   * Статистика по вопросам: % правильных полосой.
   * compact — одна строка на вопрос (блок на уроке); иначе ещё и разбор вариантов.
   */
  function questions(stats, compact) {
    return h(
      'div',
      { class: 'qstats' + (compact ? ' qstats-compact' : '') },
      stats.perQuestion.map(function (q) {
        const head = h('div', { class: 'qstat-head' }, [
          h('span', { class: 'qstat-num', text: String(q.index + 1) }),
          h('span', {
            class: 'qstat-text',
            text: q.text || 'Питання ' + (q.index + 1),
            title: q.text,
          }),
          h(
            'span',
            { class: 'qstat-bar', 'aria-hidden': 'true' },
            h('span', { class: 'qstat-fill', style: 'width: ' + q.percent + '%' }),
          ),
          h('span', { class: 'qstat-percent', text: q.percent + '%' }),
        ]);
        if (compact) {
          return h(
            'div',
            { class: 'qstat', title: q.correct + ' з ' + stats.submitted + ' правильно' },
            head,
          );
        }
        const most = Math.max.apply(null, q.counts.concat([q.none, 1]));
        const options = q.options.map(function (option, oi) {
          const isCorrect = oi === q.correctIndex;
          return h('div', { class: 'qopt' + (isCorrect ? ' qopt-correct' : '') }, [
            h('span', { class: 'qopt-text' }, [
              isCorrect ? App.icon('check') : null,
              String(option),
              isCorrect ? h('span', { class: 'qopt-tag', text: 'правильна' }) : null,
            ]),
            h(
              'span',
              { class: 'qopt-bar', 'aria-hidden': 'true' },
              h('span', {
                class: 'qopt-fill',
                style: 'width: ' + Math.round((q.counts[oi] * 100) / most) + '%',
              }),
            ),
            h('span', { class: 'qopt-count', text: String(q.counts[oi]) }),
          ]);
        });
        if (q.none) {
          options.push(
            h('div', { class: 'qopt qopt-none' }, [
              h('span', { class: 'qopt-text', text: 'без відповіді' }),
              h(
                'span',
                { class: 'qopt-bar', 'aria-hidden': 'true' },
                h('span', {
                  class: 'qopt-fill',
                  style: 'width: ' + Math.round((q.none * 100) / most) + '%',
                }),
              ),
              h('span', { class: 'qopt-count', text: String(q.none) }),
            ]),
          );
        }
        return h('div', { class: 'qstat' }, [head, h('div', { class: 'qopts' }, options)]);
      }),
    );
  }

  // ---------- CSV для Excel: разделитель «;» и BOM, чтобы кириллица читалась ----------

  function csvCell(value) {
    let s = String(value == null ? '' : value);
    // Имена вводят ученики: не даём Excel принять их за формулу
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvFileName(title, classLabel, ms) {
    const d = new Date(ms || Date.now());
    const date =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    const safe = function (s, max) {
      return String(s || '')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
    };
    const parts = ['Результати', safe(title, 60) || 'тест'];
    if (safe(classLabel, 30)) parts.push(safe(classLabel, 30));
    parts.push(date);
    return parts.join(' - ') + '.csv';
  }

  /** missing — ученики без ответа ({ id, num, name }), попадут строками «не здав(ла)». */
  function downloadCsv(stats, missing, fileName) {
    const header = ['ПК', 'Учень', 'Статус', 'Бал', 'Максимум'];
    for (let i = 0; i < stats.total; i++) header.push('Питання ' + (i + 1));
    const lines = [header];
    stats.rows.forEach(function (row) {
      lines.push(
        [
          pcText(row.pc, row.num),
          row.name,
          'здав(ла)',
          row.score === null ? '' : row.score,
          stats.total,
        ].concat(
          row.marks.map(function (mark) {
            return mark === 'ok' ? 1 : mark === 'bad' ? 0 : '';
          }),
        ),
      );
    });
    (missing || []).forEach(function (st) {
      lines.push([pcText(st.id, st.num), st.name || '', 'не здав(ла)', '', stats.total]);
    });
    const text =
      '﻿' +
      lines
        .map(function (line) {
          return line.map(csvCell).join(';');
        })
        .join('\r\n') +
      '\r\n';

    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: fileName });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10000);
  }

  App.Stats = {
    compute: compute,
    summary: summary,
    table: table,
    tiles: tiles,
    distribution: distribution,
    questions: questions,
    downloadCsv: downloadCsv,
    csvFileName: csvFileName,
    pcText: pcText,
  };
})();
