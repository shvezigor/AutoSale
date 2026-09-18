from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter
from pathlib import Path
from datetime import datetime

repo_root = Path(__file__).resolve().parents[1]
out = repo_root / 'tests' / 'fixtures' / 'manual' / 'autosale_test_products.xlsx'
wb = Workbook()
ws = wb.active
ws.title = 'Товари'
orders = wb.create_sheet('Замовлення')
guide = wb.create_sheet('Інструкція')

blue = '0000FF'
navy = '1F4E78'
light_blue = 'D9EAF7'
yellow = 'FFF2CC'
green = 'E2F0D9'
thin = Side(style='thin', color='B7C9D6')

product_headers = ['SKU', 'Назва товару', 'Категорія', 'Бренд', 'Ціна, грн', 'Собівартість, грн', 'Кількість на складі', 'Мін. залишок', 'Од. виміру', 'Постачальник', 'Статус', 'Вартість залишків, грн']
ws.append(product_headers)
products = [
    ['SKU-1001', 'Бездротові навушники AirBeat Pro', 'Електроніка', 'SoundMax', 2499, 1450, 37, 10, 'шт', 'ТОВ ТехноПостач', 'Активний'],
    ['SKU-1002', 'Павербанк Volt 20 000 mAh', 'Електроніка', 'Voltix', 1199, 690, 52, 15, 'шт', 'ТОВ ТехноПостач', 'Активний'],
    ['SKU-1003', 'USB-C кабель 2 м', 'Аксесуари', 'CablePro', 349, 120, 84, 20, 'шт', 'Гаджет-Сервіс', 'Активний'],
    ['SKU-1004', 'Механічна клавіатура MK-87', 'Електроніка', 'KeyCraft', 2899, 1740, 18, 5, 'шт', 'ТОВ ТехноПостач', 'Активний'],
    ['SKU-1005', 'Килимок для миші XL', 'Аксесуари', 'DeskFlow', 599, 260, 7, 10, 'шт', 'Гаджет-Сервіс', 'Потрібне поповнення'],
    ['SKU-1006', 'Вебкамера Full HD', 'Електроніка', 'VisionOne', 1799, 980, 23, 8, 'шт', 'МедіаТрейд', 'Активний'],
    ['SKU-1007', 'Настільна LED-лампа', 'Дім та офіс', 'LumaHome', 899, 410, 31, 8, 'шт', 'МедіаТрейд', 'Активний'],
    ['SKU-1008', 'Органайзер для кабелів', 'Дім та офіс', 'TidyDesk', 249, 80, 5, 12, 'шт', 'Гаджет-Сервіс', 'Потрібне поповнення'],
]
for i, row in enumerate(products, start=2):
    ws.append(row + [f'=E{i}*G{i}'])

order_headers = ['№ замовлення', 'Дата', 'SKU', 'Товар', 'Кількість', 'Ціна за од., грн', 'Знижка, %', 'Сума, грн', 'Статус', 'Клієнт', 'Телефон', 'Місто']
orders.append(order_headers)
sample_orders = [
    ['ORD-0001', '2026-09-01', 'SKU-1001', 'Бездротові навушники AirBeat Pro', 2, 2499, 0.05, 'Оплачено', 'Анна Коваль', '+380000000001', 'Київ'],
    ['ORD-0002', '2026-09-01', 'SKU-1003', 'USB-C кабель 2 м', 3, 349, 0, 'Нове', 'Олексій Мельник', '+380000000002', 'Львів'],
    ['ORD-0003', '2026-09-02', 'SKU-1005', 'Килимок для миші XL', 1, 599, 0.10, 'В обробці', 'Ірина Бондар', '+380000000003', 'Одеса'],
    ['ORD-0004', '2026-09-02', 'SKU-1007', 'Настільна LED-лампа', 2, 899, 0, 'Відправлено', 'Максим Шевченко', '+380000000004', 'Дніпро'],
]
for i, row in enumerate(sample_orders, start=2):
    orders.append(row[:7] + [f'=E{i}*F{i}*(1-G{i})'] + row[7:])

guide.append(['Інструкція для тесту автосейлу'])
guide.append(['Аркуш', 'Призначення'])
guide.append(['Товари', 'Каталог товарів. Для тесту змінюйте сині значення: ціну, собівартість, залишок, мінімальний залишок і статус.'])
guide.append(['Замовлення', 'Приклади замовлень. Додавайте рядки нижче таблиці або редагуйте тестові записи. Сума розраховується автоматично.'])
guide.append(['Формати', 'Ціни — гривні; знижка — десятковий дріб (0.05 = 5%); кількість — ціле число; статуси можна використовувати для перевірки фільтрів.'])
guide.append(['Примітка', 'Усі товари, ціни, залишки та замовлення є тестовими й вигаданими.'])

for sheet, table_name, end_col, end_row in [(ws, 'ProductsTable', 12, ws.max_row), (orders, 'OrdersTable', 12, orders.max_row)]:
    sheet.freeze_panes = 'A2'
    sheet.auto_filter.ref = f'A1:{get_column_letter(end_col)}{end_row}'
    tab = Table(displayName=table_name, ref=f'A1:{get_column_letter(end_col)}{end_row}')
    tab.tableStyleInfo = TableStyleInfo(name='TableStyleMedium2', showFirstColumn=False, showLastColumn=False, showRowStripes=True, showColumnStripes=False)
    sheet.add_table(tab)
    for cell in sheet[1]:
        cell.font = Font(name='Arial', bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor=navy)
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for row in sheet.iter_rows():
        for cell in row:
            cell.font = Font(name='Arial', color=blue if cell.row > 1 and cell.column not in (4, 8, 12) else '000000')
            cell.border = Border(bottom=thin)
            cell.alignment = Alignment(vertical='center')
    for col in range(1, end_col + 1):
        sheet.column_dimensions[get_column_letter(col)].width = [16, 34, 18, 16, 14, 18, 18, 14, 12, 24, 20, 20][col-1]
    sheet.row_dimensions[1].height = 34

for r in range(2, ws.max_row + 1):
    ws[f'E{r}'].number_format = '#,##0.00 [$₴-uk-UA]'
    ws[f'F{r}'].number_format = '#,##0.00 [$₴-uk-UA]'
    ws[f'L{r}'].number_format = '#,##0.00 [$₴-uk-UA]'
for r in range(2, orders.max_row + 1):
    orders[f'B{r}'].number_format = 'yyyy-mm-dd'
    for c in ('F', 'H'):
        orders[f'{c}{r}'].number_format = '#,##0.00 [$₴-uk-UA]'
    orders[f'G{r}'].number_format = '0%'

ws['L1'].comment = Comment('Формула: Ціна × Кількість на складі.', 'Codex')
orders['H1'].comment = Comment('Формула: Кількість × Ціна × (1 − Знижка).', 'Codex')
for cell in ['E1', 'F1', 'G1', 'H1', 'K1']:
    ws[cell].fill = PatternFill('solid', fgColor=light_blue)
for cell in ['E1', 'F1', 'G1', 'H1', 'I1']:
    orders[cell].fill = PatternFill('solid', fgColor=light_blue)

guide['A1'].font = Font(name='Arial', bold=True, size=16, color=navy)
guide.merge_cells('A1:B1')
for cell in guide[2]:
    cell.font = Font(name='Arial', bold=True, color='FFFFFF')
    cell.fill = PatternFill('solid', fgColor=navy)
for row in guide.iter_rows():
    for cell in row:
        cell.font = Font(name='Arial', bold=cell.row == 2, color=cell.font.color.rgb if cell.font.color and cell.font.color.type == 'rgb' else '000000')
        cell.alignment = Alignment(wrap_text=True, vertical='top')
guide.column_dimensions['A'].width = 18
guide.column_dimensions['B'].width = 105
guide.row_dimensions[1].height = 28

wb.properties.creator = 'Codex'
wb.properties.title = 'Тестовий каталог товарів для автопродажів'
wb.properties.created = datetime(2026, 9, 18, 0, 0, 0)
wb.properties.modified = datetime(2026, 9, 18, 0, 0, 0)
wb.calculation.fullCalcOnLoad = True
wb.calculation.forceFullCalc = True
wb.calculation.calcMode = 'auto'
out.parent.mkdir(parents=True, exist_ok=True)
wb.save(out)

# Verify formulas and workbook structure without replacing formulas.
check = load_workbook(out, data_only=False)
assert check['Товари']['L2'].value == '=E2*G2'
assert check['Замовлення']['H2'].value == '=E2*F2*(1-G2)'
assert len(check['Товари']['Товари' if False else 'A']) > 0
print(out.relative_to(repo_root))
