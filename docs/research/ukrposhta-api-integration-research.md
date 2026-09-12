# Дослідження інтеграції AutoSale з API Укрпошти

**Дата перевірки:** 2026-09-12  
**Обсяг:** підключення бізнес-клієнта, ключі, sandbox, адресний класифікатор, створення/зміна/видалення відправлень, ярлики, відстеження, production-обмеження.  
**Метод:** лише першоджерела АТ «Укрпошта». Основні документи: eCom від 09.03.2026, tracking від 04.03.2026, адресний класифікатор 3.21 від 14.05.2026.

## Короткий висновок

Інтеграція можлива через офіційний eCom API `0.0.1`, але це не self-service API key із Особистого кабінету. Бізнес спочатку укладає договір, після чого менеджер/додаток до договору надає окремі production і sandbox credentials. У AutoSale потрібен серверний adapter із трьома логічними клієнтами: eCom, forms і StatusTracking; ключі не можна змішувати між середовищами чи сервісами.

Мінімальний робочий ланцюжок: знайти/перевірити індекс і відділення → створити адресу → створити клієнтів відправника та одержувача → створити shipment → зберегти UUID і ШКІ → отримати PDF-ярлик → після фізичної реєстрації у відділенні читати tracking. Офіційна коротка інструкція задає саме цей порядок: [«Як почати роботу з API», версія 11.02.2026, с. 2–14](https://dev.ukrposhta.ua/uploads/how-to-use-api-11022026.pdf).

## 1. Onboarding, договір і модель credentials

- Для повного API-доступу потрібні `user token` і `authorization bearer`; їх надають після підписання договору. На бізнес-сторінці Укрпошти доступне онлайн-підписання Єдиного договору: [Укрпошта для бізнесу](https://www.ukrposhta.ua/ua/ukrposhta-dlia-biznesu), [договір за пропозицією (офертою)](https://www.ukrposhta.ua/ua/dohovir-za-propozytsiieiu-ofertoiu).
- Офіційна eCom-документація перелічує такі реквізити доступу:
  - `PRODUCTION BEARER eCom`;
  - `PRODUCTION BEARER StatusTracking`;
  - `PROD_COUNTERPARTY TOKEN`;
  - `SANDBOX BEARER eCom`;
  - `SANDBOX BEARER StatusTracking`;
  - `SAND_COUNTERPARTY TOKEN`;
  - `COUNTERPARTY UUID` — ідентифікатор контрагента, під яким створюються клієнти й інші об’єкти.
- Bearer для eCom і StatusTracking — різні навіть в одному середовищі. Token прив’язує створені бізнес-об’єкти до контрагента. Адреси є винятком: коротка інструкція прямо каже, що token захищає кожен запит, **крім створення адрес**.
- API та Особистий кабінет — окремі сервіси. Відправлення, створені через API, недоступні в Особистому кабінеті; отримувати їх треба API-запитами. Так само об’єкт з Особистого кабінету не слід очікувати в API. Джерела: [eCom API, версія 09.03.2026, с. 6–8](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf), [офіційний FAQ](https://dev.ukrposhta.ua/faq).

### Наслідки для AutoSale

- Зберігати в секретному сховищі щонайменше 6 секретів на tenant: eCom bearer + counterparty token + tracking bearer окремо для sandbox і production; `counterpartyUuid` можна зберігати як несекретний ідентифікатор конфігурації.
- У UI підключення просити production і sandbox реквізити окремо та явно позначати сервіс кожного bearer.
- Не обіцяти синхронізацію з Особистим кабінетом. Джерелом істини для створених AutoSale відправлень має бути AutoSale + eCom API.

## 2. Sandbox / тестове середовище

Офіційні sandbox base URLs:

```text
https://dev.ukrposhta.ua/ecom/0.0.1/
https://dev.ukrposhta.ua/forms/ecom/0.0.1/
```

Для sandbox використовується окрема пара `SANDBOX BEARER eCom` + `SAND_COUNTERPARTY TOKEN`, а для тестового tracking — окремий `SANDBOX BEARER StatusTracking`. У документації sandbox описано як середовище, де можна повністю налаштувати взаємодію з системою: [eCom API, версія 09.03.2026, с. 7](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf).

### Наслідки для AutoSale

- Base URL і набір credentials повинні перемикатися одним environment flag; заборонити комбінації sandbox URL + production key і навпаки.
- UUID/ШКІ sandbox та production вважати різними просторами даних. Офіційний FAQ пояснює, що 404 можливий, коли об’єкт створено в sandbox або Особистому кабінеті, а шукають його в іншому контексті: [FAQ API Укрпошти](https://dev.ukrposhta.ua/faq).
- До production rollout прогнати повний контрактний сценарій у sandbox, але окремо врахувати: tracking-події з’являються лише після фізичної реєстрації, тому sandbox не доводить production tracking end-to-end.

## 3. HTTPS endpoints та авторизація

### Production

| Сервіс | Base URL | Авторизація |
|---|---|---|
| eCom | `https://www.ukrposhta.ua/ecom/0.0.1/` | `Authorization: Bearer {eComBearer}`; `Content-Type: application/json`; `?token={counterpartyToken}` для захищених ресурсів |
| Forms | `https://www.ukrposhta.ua/forms/ecom/0.0.1/` | eCom bearer + `?token={counterpartyToken}` |
| StatusTracking | `https://www.ukrposhta.ua/status-tracking/0.0.1/` | `Authorization: Bearer {statusTrackingBearer}`; token у documented tracking endpoints не передається |
| Address classifier | `https://www.ukrposhta.ua/address-classifier-ws/` | той самий bearer, що для оформлення відправлень; `Accept: application/json` |

Джерела: [eCom API, версія 09.03.2026, с. 6](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf), [tracking API, версія 04.03.2026, с. 3](https://dev.ukrposhta.ua/uploads/Status-tracking-API-04032026.pdf), [адресний класифікатор 3.21, с. 2–3](https://dev.ukrposhta.ua/uploads/address-classifier-v3.21-14052026-ukr.pdf).

Важливо: класифікатор вимагає URL саме з `www`: `https://www.ukrposhta.ua/...`. Без `Accept: application/json` він за замовчуванням повертає XML.

### Типовий eCom-запит

```http
POST /ecom/0.0.1/shipments?token={counterpartyToken} HTTP/1.1
Host: www.ukrposhta.ua
Authorization: Bearer {eComBearer}
Content-Type: application/json
```

Token у query string — вимога поточного API. Тому AutoSale має маскувати query parameters у логах, error reporting, traces та проксі access logs.

## 4. Адресний класифікатор і створення адрес

Офіційний класифікатор призначений для інтерактивного пошуку та перевірки адрес. Рекомендований flow для адресної доставки: область → район → населений пункт → вулиця → будинок/індекс. Отриманий `postcode` передається в `POST /addresses`; повернений `addressId` — у `POST /clients?token=...`: [класифікатор 3.21, с. 3–12](https://dev.ukrposhta.ua/uploads/address-classifier-v3.21-14052026-ukr.pdf), [«Як почати роботу», с. 2–5](https://dev.ukrposhta.ua/uploads/how-to-use-api-11022026.pdf).

Практичні endpoints:

- `GET /get_city_details_by_postcode?postcode={postcode}&lang=UA` — місто/область за індексом;
- `GET /get_address_by_postcode?postcode={postcode}&lang=UA` — адреси за індексом;
- `GET /get_postcode_by_city_id?city_id={cityId}` — індекси населеного пункту;
- `GET /get_postoffices_by_postindex?pi={postcode}` — відділення за індексом;
- `GET /get_postoffices_by_city_id?...` — відділення населеного пункту;
- `GET /get_postoffices_by_postcode_cityid_cityvpzid?...` — відділення за КОАТУУ/КАТОТТГ та іншими фільтрами;
- пошук за назвами: `/get_district_by_name`, `/get_city_by_name`, `/get_street_by_name`.

Endpoint names і параметри наведені в [офіційній документації класифікатора 3.21](https://dev.ukrposhta.ua/uploads/address-classifier-v3.21-14052026-ukr.pdf).

### Обмеження класифікатора

- Сервіс застосовує динамічні обмеження залежно від навантаження й типу операції; документ називає орієнтир 50–500 RPS, рекомендує кешування, обмеження паралельності та повтори із затримкою. При перевантаженні можливі затримки або порожні результати.
- Запит має містити хоча б один параметр, інакше повертається порожня відповідь.
- Не всі знайдені записи придатні для доставки. Перевіряти `LOCK_CODE`, `IS_NODISTRICT`, `AVALIBLE`, `IS_NOLETTERS` та інші capability fields. Заблоковані адресні записи не можна використати для створення адреси. Джерело: [класифікатор 3.21, с. 3, 13–16, 36](https://dev.ukrposhta.ua/uploads/address-classifier-v3.21-14052026-ukr.pdf).

### Наслідки для AutoSale

- Не використовувати класифікатор як bulk-download API; додати tenant-neutral cache, debounce autocomplete, bounded concurrency, exponential backoff із jitter.
- Порожню відповідь не трактувати автоматично як «нічого не знайдено»: після тимчасової паузи повторити запит.
- У UI показувати лише активні/доставочні відділення й зберігати stable identifiers плюс snapshot назви/адреси.

## 5. Відправлення: create, read, update, delete

Перед shipment треба мати `addressId`, потім UUID клієнтів-відправника та одержувача. Основні операції:

| Операція | Метод і path |
|---|---|
| Створити | `POST /shipments?token={token}` |
| Отримати за UUID | `GET /shipments/{shipmentUuid}?token={token}` |
| Отримати за ШКІ | `GET /shipments/barcode/{shipmentBarcode}?token={token}` |
| Змінити | `PUT /shipments/{shipmentUuid}?token={token}` |
| Змінити кілька | `PUT /shipments?token={token}` |
| Життєвий цикл | `GET /shipments/{barcodeOrUuid}/lifecycle?token={token}` |
| Видалити | `DELETE /shipments/{shipmentUuid}?token={token}` |

Створення приймає посилання на `sender.uuid`, `recipient.uuid`, `deliveryType`, payer flags і `parcels`; відповідь містить UUID, barcode, розрахунок вартості та lifecycle. Для update кожне змінюване місце в `parcels` треба ідентифікувати його UUID або barcode. Видалення повертає `200` із порожнім тілом. Джерело: [eCom API, версія 09.03.2026, розділ 4](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf).

Критичне state restriction: змінити або видалити відправлення можна лише до реєстрації у відділенні; delete дозволений лише для `lifecycle.status = CREATED`: [«Як почати роботу», с. 2](https://dev.ukrposhta.ua/uploads/how-to-use-api-11022026.pdf), [eCom API, версія 09.03.2026, розділ 4](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf).

Актуальне contract-dependent поле: з 29.12.2025 для `onFailReceiveType` підтримуються лише `RETURN` і `PROCESS_AS_REFUSAL`; строк повернення 7/14 днів система визначає автоматично залежно від типу відділення: [офіційне оновлення API від 29.12.2025](https://dev.ukrposhta.ua/news-23).

### Наслідки для AutoSale

- Зберігати `shipmentUuid`, shipment barcode, parcel UUID/barcode, last known lifecycle, calculated price та environment.
- Зробити create idempotent на рівні AutoSale: перед повтором після timeout перевіряти локальний correlation/external ID і API, щоб не створювати дублікати.
- Кнопки edit/delete вимикати після виходу зі стану `CREATED`; сервер усе одно має повторно перевіряти відповідь API.
- Не хардкодити доступність спеціальних послуг: частина опцій залежить від договору, типу клієнта, відділення, маршруту й типу відправлення.

## 6. PDF-ярлик і супровідні документи

Forms API повертає PDF у бінарному вигляді. Основні endpoints:

- `GET {formsBase}/shipments/{shipmentUuidOrBarcode}/sticker?token={token}` — ярлик 100×100;
- той самий endpoint із `&size=SIZE_A4` або `&size=SIZE_A5`;
- `GET {formsBase}/shipment-groups/{shipmentGroupUuid}/sticker?token={token}` — груповий ярлик;
- `POST {formsBase}/shipments/stickers-by-barcodes?token={token}&size={formSize}` — пакет ярликів без групи;
- `GET {formsBase}/shipment-groups/{shipmentGroupUuid}/form103a?token={token}` — форма 103а.

Для 100×100 документація дозволяє path `sticker` або `label`. Джерела: [eCom API, версія 09.03.2026, розділ 10](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf), [«Як почати роботу», с. 14–15](https://dev.ukrposhta.ua/uploads/how-to-use-api-11022026.pdf).

### Наслідки для AutoSale

- Forms response обробляти як binary/PDF, не як JSON; перевіряти HTTP status і `Content-Type` перед збереженням.
- Не передавати PDF напряму через frontend із token у URL. Backend має забрати документ, приховати credentials і віддати користувачу контрольований download/preview.
- Закласти регресійний тест розміру/читабельності ярлика: Укрпошта окремо публікує зміни формату стікера на developer portal.

## 7. Tracking

StatusTracking має окремий bearer і base URL. Основні запити:

- `GET /statuses?barcode={barcode}` — усі події;
- `GET /statuses/last?barcode={barcode}` — остання подія;
- `POST /statuses` з масивом ШКІ — усі події для списку;
- `POST /statuses/last` — останні події для списку (описано в офіційному документі);
- `&lang=en` — англомовна відповідь для endpoints, де параметр документовано.

Для batch усіх статусів документація встановлює максимум 50 barcodes в одному запиті. Найважливіша семантика: shipment потрапляє до tracking лише після реєстрації у відділенні; до цього tracking повертає «не знайдено». Це не слід плутати з eCom lifecycle, де щойно створений об’єкт має стан `CREATED`: [StatusTracking API, версія 04.03.2026, с. 3–9](https://dev.ukrposhta.ua/uploads/Status-tracking-API-04032026.pdf).

### Наслідки для AutoSale

- До фізичної реєстрації показувати локальний/eCom стан «створено», а не помилку tracking.
- Починати polling tracking після реєстрації/очікуваного handoff; batch запити дробити максимум по 50 ШКІ.
- Зберігати сирі `event`, `eventReason_id`, timestamp і відділення, а користувацький статус будувати окремим versioned mapping: список подій може розширюватися.

## 8. Production restrictions і go-live checklist

Підтверджені офіційною документацією обмеження:

1. Доступ видається після договору; production API не є анонімним/self-service сервісом.
2. Production, sandbox, eCom і tracking мають окремі ключі.
3. API-дані відокремлені від Особистого кабінету.
4. Update/delete shipment можливі лише до реєстрації; delete — тільки у стані `CREATED`.
5. Tracking починається лише після реєстрації у відділенні.
6. Класифікатор rate-limited, може повертати порожній результат при перевантаженні та містить заблоковані/недоставочні записи.
7. Частина сервісів/полів доступна лише якщо це передбачено договором та властивостями контрагента/відділення.
8. Документація прямо попереджає, що може змінюватися без попередження; актуальну версію слід брати через [developer portal](https://dev.ukrposhta.ua/documentation) або `GET https://www.ukrposhta.ua/ecom/0.0.1/doc`.

Перед production:

- отримати письмово/у додатку до договору всі production та sandbox credentials;
- звірити активовані contract capabilities: післяплата, переказ на рахунок/картку, огляд, courier/door delivery, return behavior;
- виконати sandbox contract tests для адреси → client → shipment → update → PDF → delete;
- виконати один контрольований production shipment без післяплати, потім з післяплатою;
- перевірити фактичний ярлик, приймання у відділенні, першу tracking-подію, вручення/повернення;
- увімкнути redaction `token`/`Authorization` у всіх логах і telemetry;
- налаштувати timeout, retry тільки для безпечних операцій, idempotency/deduplication для create;
- зафіксувати контакти: `api-support@ukrposhta.ua` для технічних питань і `support-yo@ukrposhta.ua` для корпоративного обслуговування: [developer portal](https://dev.ukrposhta.ua/documentation).

## Рекомендований мінімальний scope реалізації

1. Конфігурація sandbox/production credentials і health check без розкриття секретів.
2. Cached address/post-office search із фільтрацією capability fields.
3. Address/client provisioning і збереження remote IDs.
4. Shipment create/read/lifecycle + контрольована зміна/видалення у `CREATED`.
5. Server-side PDF sticker proxy/storage.
6. Tracking adapter з окремим bearer, delayed polling і batch ≤ 50.
7. Audit log без token/bearer та feature flags для contract-dependent послуг.

## Офіційні джерела

- [Портал API Укрпошти](https://dev.ukrposhta.ua/)
- [Каталог актуальної документації](https://dev.ukrposhta.ua/documentation)
- [eCom API — відправлення по Україні, версія 09.03.2026](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf)
- [Як почати роботу з API, версія 11.02.2026](https://dev.ukrposhta.ua/uploads/how-to-use-api-11022026.pdf)
- [StatusTracking API, версія 04.03.2026](https://dev.ukrposhta.ua/uploads/Status-tracking-API-04032026.pdf)
- [Адресний класифікатор 3.21, версія 14.05.2026](https://dev.ukrposhta.ua/uploads/address-classifier-v3.21-14052026-ukr.pdf)
- [FAQ API Укрпошти](https://dev.ukrposhta.ua/faq)
- [Укрпошта для бізнесу](https://www.ukrposhta.ua/ua/ukrposhta-dlia-biznesu)
- [Договір за пропозицією (офертою)](https://www.ukrposhta.ua/ua/dohovir-za-propozytsiieiu-ofertoiu)
- [Оновлення eCom від 29.12.2025](https://dev.ukrposhta.ua/news-23)


