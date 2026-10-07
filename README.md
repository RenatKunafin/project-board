# Project Board

PWA-дашборд для управления проектами: платформа виджетов (вкладки, тайлинг/каскад) и модули Гантта и чек-листа. Проект на стадии проектирования — продуктового кода пока нет.

## Документация

- [Решения по проекту](.context/project-decisions.md) — согласованные решения и открытые вопросы
- [Бэклог](.context/tasks/README.md) — задачи PBT-001–PBT-065 и статусы
- [Процесс работы](.context/openspec-workflow.md) — «одна задача PBT = один OpenSpec change = один PR»
- [Настройка OpenSpec](.context/openspec-setup.md) — версии и установка с нуля

## Инструментарий

Node.js 22, OpenSpec CLI 1.11.0. Проверка артефактов:

```bash
openspec validate --all --strict --no-interactive
```

Для AI-агентов — [AGENTS.md](AGENTS.md).
