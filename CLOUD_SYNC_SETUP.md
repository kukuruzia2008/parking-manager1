# Настройка облачной синхронизации Parking Manager

## Почему аккаунт может просить регистрацию снова

Если `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` не заданы, приложение использует демо-аккаунты в `localStorage`. Они хранятся только в конкретном браузере и на конкретном адресе сайта. Например, `http://localhost:5180`, `http://192.168.x.x:5180` и опубликованный HTTPS-домен имеют разные хранилища. Такие аккаунты не синхронизируются между компьютером и iPhone.

## Подключение Supabase

1. Создайте проект в Supabase.
2. В панели Supabase откройте **SQL Editor**.
3. Откройте `supabase/schema.sql` в проекте, скопируйте весь SQL, вставьте в SQL Editor и выполните.
4. В панели Supabase откройте **Project Settings → API** (или раздел API Keys в новой панели).
5. Скопируйте Project URL и публичный `anon`/`publishable` key. Не используйте `service_role` или secret key в браузерном приложении.
6. В корне проекта скопируйте `.env.example` в новый файл `.env.local`.
7. Заполните `.env.local`:

```env
VITE_SUPABASE_URL=https://ВАШ_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=ВАШ_ПУБЛИЧНЫЙ_КЛЮЧ
```

8. В Supabase откройте **Authentication → URL Configuration**. Укажите опубликованный HTTPS-домен в Site URL и добавьте его в Redirect URLs. Для локальной разработки добавьте `http://localhost:5180/**`.
9. Перезапустите Vite после изменения `.env.local`:

```cmd
npm.cmd run dev
```

10. Откройте приложение и зарегистрируйте аккаунт один раз через Supabase. На компьютере и iPhone используйте **один и тот же email и пароль**. После входа данные `user_app_state` синхронизируются между устройствами.

## Важно

- Данные старых локальных демо-аккаунтов автоматически в Supabase не переносятся.
- Каждый пользователь видит только своё состояние благодаря RLS-политике `user_app_state` из `supabase/schema.sql`.
- В браузере доступен только публичный ключ Supabase. Никогда не вставляйте `service_role`/secret key в `.env.local` фронтенда.
- Если Supabase не настроен или SQL не выполнен, облачная синхронизация не заработает. В профиле будет статус «Только это устройство».
