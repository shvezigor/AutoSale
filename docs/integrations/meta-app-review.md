# Meta App Review для AutoSale

Цей документ фіксує стан заявки Meta та відтворюваний сценарій перевірки.
Секрети Meta, Instagram-токени й облікові дані реальних клієнтів сюди не
додаються.

## Поточний стан

- Meta app `AutoSale` опублікований.
- У заявці залишено лише `instagram_business_basic` і
  `instagram_business_manage_messages`.
- Налаштовано HTTPS OAuth callback, webhook, deauthorization callback і data
  deletion callback.
- Webhook успішно пройшов verification і тест поля `messages`.
- Додано платформу Website з публічним URL AutoSale.
- У reviewer instructions зазначено, що AutoSale використовує власний вхід за
  email/паролем і не інтегрує Facebook Login.
- Створено окремий активний AutoSale workspace для Meta reviewer. Його
  credentials зберігаються лише в чернетці Meta App Review, не в Git.

## Що блокує подання

1. Завантажити в Meta App settings файл
   `apps/web/public/autosale-icon.png` як app icon 1024×1024.
2. Підготувати окремий публічний Instagram Professional test account. Він має
   пройти OAuth без помилки ролі й бути доступним під час review.
3. Записати screencast для кожного дозволу. Meta вимагає показати повний
   end-to-end сценарій, тому текстовий опис не замінює відео.
4. Завершити Verification, Data handling і решту обов'язкових питань у
   submission draft.
5. Перевірити заявку ще раз і лише після цього натиснути Submit for review.
   Після подання чернетку вже не можна редагувати.

Тимчасовий `trycloudflare.com` URL придатний для розробки, але може змінитися
після перезапуску quick tunnel. Перед поданням краще перейти на named
Cloudflare Tunnel і власний стабільний домен, щоб reviewer URL не зник.

## Сценарій screencast

Запис має бути без монтажних розривів, із видимим URL браузера. Не показуйте
паролі, app secret, access token, verify token або `.env`.

### `instagram_business_basic`

1. Відкрити публічний `/login` і ввійти тестовим AutoSale reviewer account.
2. Перейти в **Налаштування → Інтеграції → Instagram**.
3. Натиснути **Підключити Instagram**.
4. Авторизувати окремий Instagram Professional test account.
5. Повернутися в AutoSale й показати картку інтеграції з активним статусом,
   Instagram username та account ID.
6. Пояснити, що permission потрібен для ідентифікації підключеного акаунта і є
   залежністю для `instagram_business_manage_messages`.

### `instagram_business_manage_messages`

1. Почати з уже підключеного Instagram Professional test account.
2. З іншого Instagram-акаунта надіслати одне тестове повідомлення із простим
   замовленням.
3. В AutoSale відкрити список діалогів і показати отримане повідомлення.
4. Показати розпізнані поля замовлення та опціональний manager approval.
5. Не показувати Google Sheets як причину доступу до Meta: це downstream дія
   AutoSale, а permission використовується саме для отримання DM.

## Текст для обґрунтування дозволів

Для `instagram_business_basic` пояснити, що AutoSale отримує лише ідентичність
професійного акаунта, показує її власнику workspace та використовує цей scope
як обов'язкову залежність доступу до повідомлень.

Для `instagram_business_manage_messages` пояснити, що AutoSale отримує вхідні
DM бізнесу, маршрутизує їх лише в його tenant, показує менеджеру і перетворює
підтверджені замовлення на структуровані записи. Дані інших tenant недоступні
ані клієнту, ані platform admin.

## Фінальна перевірка

- [ ] App icon прийнято Meta, попередження `Currently ineligible` відсутнє.
- [ ] Reviewer credentials працюють у приватному вікні браузера.
- [ ] OAuth завершується для окремого Professional test account.
- [ ] Картка інтеграції показує правильний username.
- [ ] Реальний DM потрапляє в правильний tenant.
- [ ] Обидва screencast завантажені й не містять секретів.
- [ ] Privacy, Terms і Data deletion URL повертають HTTP 200.
- [ ] У заявці немає permissions, які продукт не використовує.
- [ ] Публічний домен залишатиметься активним протягом усього review.
- [ ] Перед Submit виконано ручний перегляд усіх відповідей.
