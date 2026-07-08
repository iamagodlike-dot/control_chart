// Presentational «Запчасти» screen — a faithful port of the design reference
// (Диспетчерская.dc.html, lines ~1072-1256 + prompt modals). It is a PURE view:
// all data comes from `vm` (buildPartsVM output) and all mutations go through
// the handler props. The same component backs the real screen (Parts.jsx, live
// Firestore data) and the standalone demo (seed data) so they can never diverge.
//
// The reference's EXACT css variables live in the <style> block below (scoped to
// .psx) instead of inline, so they can switch with the app theme: dark by default,
// light under [data-theme="light"]. Brand + status colors are identical in both
// themes (same as the host app), so only the neutrals are overridden for light.

// Parse an inline-style string ("a:b;c:d") into a React style object so the
// reference's style strings can be pasted verbatim.
function css(str) {
  const o = {};
  String(str).split(';').forEach((decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (!k) return;
    o[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  });
  return o;
}

// Inline SVG identical to the reference (inner markup pasted as-is).
function Ico({ size = 16, sw = 1.8, stroke = 'currentColor', fill = 'none', style, paths }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" style={style} dangerouslySetInnerHTML={{ __html: paths }} />
  );
}
const I = {
  alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path>',
  close: '<path d="M18 6 6 18M6 6l12 12"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
  funnel: '<path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"></path>',
  car: '<path d="M6 11l1.5-4A2 2 0 0 1 9.4 6h5.2a2 2 0 0 1 1.9 1.3L18 11M4 11h16v6H4zM8 18v0M16 18v0"></path>',
  warehouse: '<path d="M3 9l9-6 9 6v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M9 22V12h6v10"></path>',
  cart: '<circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.5 3h2l2.6 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"></path>',
  inbox: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"></path>',
  issue: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>',
  check: '<path d="M20 6 9 17l-5-5"></path>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
  swap: '<path d="m17 2 4 4-4 4M3 6h18M7 22l-4-4 4-4M21 18H3"></path>',
  cal: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18M16 10a4 4 0 0 1-8 0"></path>',
  truck: '<path d="M14 17V6a1 1 0 0 0-1-1H2v12h2M14 9h5l3 3v5h-2M8 17h6"></path><circle cx="6" cy="17" r="2"></circle><circle cx="18" cy="17" r="2"></circle>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8h.01M11 12h1v4h1"></path>',
};

export default function PartsScreen(props) {
  const {
    vm, search = '',
    onSearch, onFilter, onClearFilter,
    onStatus, onAdvance, onName, onArticle, onCopyArticle, onKind, onOpenRepl,
    onOrderedAt, onEta, onQty, onSupplier, onCost, onRemove, onAdd,
    onPaintCode, onPaintType, onPaintVolume, onPaintCost, onPaintStatus,
    supplierNames = [],
    orderPrompt, onOrderDraft, confirmOrder, cancelOrder,
    etaPrompt, onEtaDraft, confirmEta, cancelEta,
    replPrompt, onReplDraft, confirmRepl, cancelRepl,
    onOpenCar,
    banner,
  } = props;

  const wrap = { fontFamily: "'Manrope',system-ui,sans-serif", background: 'var(--bg)', color: 'var(--text)', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 };

  return (
    <div className="psx" style={wrap}>
      <style>{`
        .psx{--bg:#080b10;--bg2:#0b0f15;--panel:#0e131a;--panel2:#121924;--line:#1e2732;--line2:#2b3644;--text:#e8edf4;--text2:#8e9bab;--text3:#5a6674;--brand:#29d3e8;--brand-soft:color-mix(in srgb,#29d3e8 16%,transparent);--planned:#6b7a8d;--progress:#2fbbd6;--done:#37d399;--delay:#ff5468;--wait:#f7a93a;--grid:rgba(255,255,255,.035)}
        [data-theme="light"] .psx{--bg:#e7ebf0;--bg2:#eef2f6;--panel:#ffffff;--panel2:#f4f7fa;--line:#d5dce4;--line2:#c3ccd7;--text:#141a22;--text2:#4c5766;--text3:#7d8896;--grid:rgba(0,0,0,.04)}
        .psx svg{flex:0 0 auto}
        .psx input:focus,.psx select:focus{border-color:var(--brand)!important}
        .psx button{transition:all .15s}
        .psx *{box-sizing:border-box}
        .psx .ps-carhead{cursor:pointer;padding:8px 12px;margin:-8px -12px;border-radius:10px;transition:background .15s}
        .psx .ps-carhead:hover{background:var(--brand-soft)}
        .psx .ps-carhead:active{background:color-mix(in srgb,var(--brand) 24%,transparent)}
      `}</style>
      {banner}
      <div style={css('flex:1 1 auto;display:flex;flex-direction:column;min-height:0;background:var(--bg)')}>

        {/* ---- filter chips + search ---- */}
        <div style={css('flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:14px 22px;border-bottom:1px solid var(--line);flex-wrap:wrap')}>
          <div style={css('display:flex;gap:8px;flex-wrap:wrap')}>
            {vm.statusChips.map((s) => (
              <button key={s.id} onClick={() => onFilter(s.id)} style={s.style}>
                <span style={s.dotStyle} />
                <span style={css("font-family:'Manrope';font-weight:600;font-size:12.5px")}>{s.label}</span>
                <span style={css("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px")}>{s.count}</span>
              </button>
            ))}
            <button onClick={() => onFilter('overdue')} style={vm.overdueChip.style}>
              <Ico size={13} sw={2} paths={I.alert} />
              <span style={css("font-family:'Manrope';font-weight:600;font-size:12.5px")}>Просрочка</span>
              <span style={css("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px")}>{vm.overdueChip.count}</span>
            </button>
            {vm.hasFilter && (
              <button onClick={onClearFilter} title="Показать все позиции" style={css("display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:9px;cursor:pointer;border:1px solid var(--line2);background:transparent;color:var(--text2);font-family:'Manrope';font-weight:600;font-size:12.5px")}>
                <Ico size={13} sw={2.2} paths={I.close} />Сбросить фильтр
              </button>
            )}
          </div>
          <div style={css('margin-left:auto;position:relative;flex:0 0 260px')}>
            <span style={css('position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text3);display:flex')}><Ico size={15} paths={I.search} /></span>
            <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Поиск: деталь, артикул, машина…" style={vm.searchStyle} />
          </div>
        </div>

        {/* ---- KPI bar ---- */}
        <div style={css('flex:0 0 auto;display:flex;align-items:stretch;gap:0;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--bg2)')}>
          <div style={css('display:flex;flex-direction:column;gap:4px;padding-right:26px')}>
            <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)")}>В работе</span>
            <div style={css('display:flex;align-items:baseline;gap:7px')}><span style={css("font-family:'JetBrains Mono',monospace;font-size:23px;font-weight:800;color:var(--wait);line-height:1")}>{vm.actionNeeded}</span><span style={css('font-size:11px;color:var(--text3)')}>поз. · заказ/доставка</span></div>
          </div>
          <div style={css('width:1px;background:var(--line);flex:0 0 auto')} />
          <div style={css('display:flex;flex-direction:column;gap:4px;padding:0 26px')}>
            <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)")}>Сумма по ЗН</span>
            <div style={css('display:flex;align-items:baseline;gap:7px')}><span style={css("font-family:'JetBrains Mono',monospace;font-size:23px;font-weight:800;color:var(--brand);line-height:1")}>{vm.totalOrderStr}</span><span style={css('font-size:11px;color:var(--text3)')}>выставлено клиенту</span></div>
          </div>
          {vm.hasDiscountTotal && (
            <>
              <div style={css('width:1px;background:var(--line);flex:0 0 auto')} />
              <div style={css('display:flex;flex-direction:column;gap:4px;padding:0 26px')}>
                <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)")}>Скидка з/ч</span>
                <div style={css('display:flex;align-items:baseline;gap:7px')}><span style={css("font-family:'JetBrains Mono',monospace;font-size:23px;font-weight:800;color:var(--wait);line-height:1")}>− {vm.discountTotalStr}</span><span style={css('font-size:11px;color:var(--text3)')}>учтена в марже</span></div>
              </div>
            </>
          )}
          <div style={css('width:1px;background:var(--line);flex:0 0 auto')} />
          <div style={css('display:flex;flex-direction:column;gap:4px;padding:0 26px')}>
            <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)")}>Рентабельность{vm.hasDiscountTotal ? ' со скидкой' : ''}</span>
            <div style={css('display:flex;align-items:baseline;gap:7px')}><span style={{ ...css("font-family:'JetBrains Mono',monospace;font-size:23px;font-weight:800;line-height:1"), color: vm.hasDiscountTotal ? vm.netRentabColor : vm.rentabColor }}>{vm.hasDiscountTotal ? vm.netRentabStr : vm.rentabStr}</span><span style={css("font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3)")}>маржа {vm.hasDiscountTotal ? vm.netTotalMarginStr : vm.totalMarginStr}</span></div>
            {vm.hasDiscountTotal && <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)")}>до скидки {vm.rentabStr} · маржа {vm.totalMarginStr}</span>}
            {vm.rentCountedStr && <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--delay)")}>{vm.rentCountedStr}</span>}
          </div>
          <div title="Показатели бара считаются по позициям, видимым в текущем фильтре/поиске — ровно те же, что суммируются в карточках авто ниже" style={vm.scopeStyle}>
            <Ico size={12} sw={2} paths={I.funnel} />
            <span style={css("font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase")}>{vm.scopeLabel}</span>
          </div>
          {vm.missingCost > 0 && (
            <div title={vm.missingHint} style={css('margin-left:auto;align-self:center;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;background:color-mix(in srgb,var(--delay) 12%,transparent);border:1px solid color-mix(in srgb,var(--delay) 32%,transparent);color:var(--delay);cursor:help')}>
              <Ico size={14} paths={I.alert} />
              <span style={css("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px")}>{vm.missingCost}</span>
              <span style={css('font-size:11.5px')}>без себестоимости</span>
            </div>
          )}
        </div>

        {/* ---- car groups ---- */}
        <div style={css('flex:1 1 auto;overflow-y:auto;min-height:0;padding:22px;display:flex;flex-direction:column;gap:18px')}>
          {vm.isEmpty && (
            <div style={css('text-align:center;padding:44px 20px;color:var(--text3);border:1px dashed var(--line2);border-radius:12px;flex:0 0 auto')}>
              <div style={css('font-weight:600;font-size:14px;color:var(--text2)')}>Ничего не найдено</div>
              <div style={css('font-size:12.5px;margin-top:4px')}>Измените фильтр или поиск</div>
            </div>
          )}
          {vm.groups.map((g) => (
            <div key={g.carId} style={css('background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;flex:0 0 auto')}>
              {/* group head */}
              <div style={css('display:flex;align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid var(--line);background:var(--panel2);flex-wrap:wrap')}>
                <div
                  className={onOpenCar ? 'ps-carhead' : undefined}
                  onClick={onOpenCar ? () => onOpenCar(g.carId) : undefined}
                  title={onOpenCar ? 'Открыть карточку автомобиля' : undefined}
                  style={css('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}
                >
                  <Ico size={17} sw={1.7} stroke="var(--brand)" style={{ flex: '0 0 auto' }} paths={I.car} />
                  <span style={css('font-weight:700;font-size:16px')}>{g.model}</span>
                  <span style={css("font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:var(--text2);padding:3px 9px;border:1px solid var(--line2);border-radius:6px")}>{g.plate}</span>
                  <span style={css("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text3)")}>№{g.num} · {g.client}</span>
                </div>
                {g.hasCells && (
                  <div style={css('display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
                    <Ico size={14} sw={1.7} stroke="var(--text3)" style={{ flex: '0 0 auto' }} paths={I.warehouse} />
                    {g.cells.map((cell) => (
                      <span key={cell.id} title={cell.title} style={css("display:flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:7px;border:1px solid color-mix(in srgb,var(--done) 34%,transparent);background:color-mix(in srgb,var(--done) 10%,transparent);color:var(--done);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;flex:0 0 auto")}>
                        {cell.id}<span style={css('font-weight:600;color:color-mix(in srgb,var(--done) 70%,var(--text3))')}>· {cell.count}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div style={css('margin-left:auto;display:flex;align-items:center;gap:18px')}>
                  <div style={css('text-align:right')}><div style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>По ЗН</div><div style={css("font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--brand)")}>{g.orderSumStr}</div></div>
                  {g.hasDiscount && (
                    <div title={g.discountTitle} style={css('text-align:right;cursor:help')}><div style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Скидка</div><div style={css("font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--wait)")}>− {g.discountStr}</div></div>
                  )}
                  <div title={g.hasDiscount ? ('До скидки: ' + g.grentabStr + ' · маржа ' + g.marginStr) : g.grentabTitle} style={css('text-align:right')}><div style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Рентаб.{g.hasDiscount ? ' ✓' : ''}</div><div style={{ ...css("font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700"), color: g.hasDiscount ? g.netRentabColor : g.grentabColor }}>{g.hasDiscount ? g.netRentabStr : g.grentabStr}</div></div>
                  <div title={g.hasDiscount ? ('Со скидкой. До скидки: ' + g.marginStr) : undefined} style={css('text-align:right')}><div style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Маржа{g.hasDiscount ? ' ✓' : ''}</div><div style={{ ...css("font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700"), color: g.hasDiscount ? g.netMarginColor : g.marginColor }}>{g.hasDiscount ? g.netMarginStr : g.marginStr}</div></div>
                </div>
              </div>

              {/* rows */}
              <div style={css('padding:6px 18px 14px')}>
                <div style={css("display:grid;grid-template-columns:186px 1fr 44px 118px 120px 96px 96px 40px;gap:12px;padding:9px 4px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--line)")}>
                  <span>Статус · переход</span><span>Деталь / артикул</span><span style={{ textAlign: 'center' }}>Кол</span><span>Поставщик</span><span>Себест., ₽/шт</span><span style={{ textAlign: 'right' }}>Рентаб.</span><span style={{ textAlign: 'right' }}>По ЗН</span><span />
                </div>
                {g.rows.map((p) => (
                  <div key={p.id} style={p.rowStyle}>
                    {/* status + advance */}
                    <div style={css('display:flex;align-items:center;gap:6px;min-width:0')}>
                      <select value={p.status} onChange={(e) => onStatus(g.carId, p.id, e.target.value)} style={p.statusSelStyle}>
                        {p.statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {p.advIsOrder && <button onClick={() => onAdvance(g.carId, p.id)} title="Заказать деталь" style={p.advOrderStyle}><Ico size={15} paths={I.cart} /></button>}
                      {p.advIsArrive && <button onClick={() => onAdvance(g.carId, p.id)} title="Отметить поступление на склад" style={p.advArriveStyle}><Ico size={15} paths={I.inbox} /></button>}
                      {p.advIsIssue && <button onClick={() => onAdvance(g.carId, p.id)} title="Выдать в работу" style={p.advIssueStyle}><Ico size={15} paths={I.issue} /></button>}
                      {p.advIsDone && <span title="Выдана — цикл завершён" style={css('width:32px;height:34px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--text3);display:flex;align-items:center;justify-content:center;flex:0 0 auto')}><Ico size={15} sw={2} paths={I.check} /></span>}
                    </div>
                    {/* name / identity */}
                    <div style={css('min-width:0')}>
                      <input value={p.name} onChange={(e) => onName(g.carId, p.id, e.target.value)} placeholder="Название детали" style={css("width:100%;height:30px;padding:0 8px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--text);font-family:'Manrope';font-weight:600;font-size:13.5px;outline:none")} />
                      <div style={css('display:flex;align-items:center;gap:10px;margin-top:4px;padding-left:8px;min-width:0')}>
                        <div style={css('display:flex;align-items:center;gap:9px;flex:0 0 380px;overflow:hidden')}>
                          <select value={p.kind} onChange={(e) => onKind(g.carId, p.id, e.target.value)} title="Тип запчасти" style={p.kindBadgeStyle}>
                            {p.kindOptions.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                          </select>
                          <div style={css('width:1px;height:14px;background:var(--line);flex:0 0 auto')} />
                          <div style={css('display:flex;align-items:center;gap:2px;flex:0 0 auto')}>
                            <input value={p.article} onChange={(e) => onArticle(g.carId, p.id, e.target.value)} placeholder="ориг. артикул" style={css("width:104px;height:24px;padding:0 6px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--text2);font-family:'JetBrains Mono',monospace;font-size:11px;outline:none")} />
                            {p.hasArticle && <button onClick={() => onCopyArticle(p.article)} title="Скопировать артикул" style={css('width:24px;height:24px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--text3);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto')}><Ico size={12} paths={I.copy} /></button>}
                          </div>
                          {p.hasRepl && (
                            <button onClick={() => onOpenRepl(g.carId, p.id)} title="Аналог/заменитель — нажмите, чтобы изменить артикулы" style={css("display:flex;align-items:center;gap:5px;height:24px;max-width:118px;padding:0 9px;border-radius:6px;border:1px solid color-mix(in srgb,var(--brand) 34%,transparent);background:color-mix(in srgb,var(--brand) 11%,transparent);color:var(--brand);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;cursor:pointer;flex:0 0 auto")}>
                              <Ico size={12} sw={1.9} style={{ flex: '0 0 auto' }} paths={I.swap} />
                              <span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0')}>{p.replArticle}</span>
                            </button>
                          )}
                          {p.noReplAnalog && (
                            <button onClick={() => onOpenRepl(g.carId, p.id)} title="Указать артикул аналога" style={css("display:flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:6px;border:1px dashed color-mix(in srgb,var(--brand) 45%,transparent);background:transparent;color:var(--brand);font-family:'Manrope';font-weight:600;font-size:11px;cursor:pointer;flex:0 0 auto")}>
                              <Ico size={12} sw={1.9} style={{ flex: '0 0 auto' }} paths={I.swap} />аналог
                            </button>
                          )}
                        </div>
                        <div style={css('width:1px;height:14px;background:var(--line);flex:0 0 auto')} />
                        <div style={css('display:flex;align-items:center;gap:10px;flex:0 0 auto')}>
                          <div style={css('display:flex;align-items:center;gap:5px;flex:0 0 auto')} title="Дата заказа">
                            <Ico size={13} sw={1.7} stroke="var(--text3)" style={{ flex: '0 0 auto' }} paths={I.cal} />
                            <input value={p.orderedAt} onChange={(e) => onOrderedAt(g.carId, p.id, e.target.value)} placeholder="дд.мм" style={css("width:48px;height:24px;padding:0 5px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--text3);font-family:'JetBrains Mono',monospace;font-size:11px;outline:none")} />
                          </div>
                          <div style={css('display:flex;align-items:center;gap:5px;flex:0 0 auto')} title="Ожидаемая дата поставки (ETA)">
                            <Ico size={14} sw={1.7} stroke={p.etaColor} style={{ flex: '0 0 auto' }} paths={I.truck} />
                            <input value={p.eta} onChange={(e) => onEta(g.carId, p.id, e.target.value)} placeholder="дд.мм" style={p.etaFieldStyle} />
                          </div>
                          {p.overdue && <span style={css("font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--delay);padding:2px 7px;border-radius:5px;background:color-mix(in srgb,var(--delay) 14%,transparent);flex:0 0 auto")}>ПРОСРОЧКА</span>}
                        </div>
                      </div>
                    </div>
                    {/* qty */}
                    <input value={p.qty} onChange={(e) => onQty(g.carId, p.id, e.target.value)} style={css("width:100%;height:32px;padding:0;border-radius:7px;border:1px solid var(--line2);background:var(--panel2);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:13px;text-align:center;outline:none")} />
                    {/* supplier */}
                    <input value={p.supplier} onChange={(e) => onSupplier(g.carId, p.id, e.target.value)} list="supplier-presets" placeholder="—" style={css("width:100%;height:32px;padding:0 10px;border-radius:7px;border:1px solid var(--line2);background:var(--panel2);color:var(--text2);font-family:'Manrope';font-size:12.5px;outline:none")} />
                    {/* cost */}
                    <div style={css('position:relative')}>
                      <input value={p.costStr} onChange={(e) => onCost(g.carId, p.id, e.target.value)} inputMode="numeric" placeholder="0" style={{ ...css("width:100%;height:32px;padding:0 10px;border-radius:7px;background:var(--panel2);color:var(--text);font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;text-align:right;outline:none"), border: '1px solid ' + p.costBorder }} />
                    </div>
                    {/* per-line rentab */}
                    <span style={{ ...css("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;text-align:right"), color: p.rentabColor }}>{p.rentabStr}</span>
                    {/* order price */}
                    <span style={css("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;text-align:right;color:var(--brand)")}>{p.orderPriceStr}</span>
                    {/* remove */}
                    <div style={css('display:flex;align-items:center;justify-content:flex-end')}>
                      <button onClick={() => onRemove(g.carId, p.id)} title="Удалить" style={css('width:30px;height:30px;border-radius:7px;border:1px solid var(--line2);background:transparent;color:var(--text3);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto')}><Ico size={13} sw={2} paths={I.close} /></button>
                    </div>
                  </div>
                ))}
                <button onClick={() => onAdd(g.carId)} style={css("margin-top:12px;height:36px;padding:0 14px;border-radius:9px;border:1px dashed var(--line2);background:transparent;color:var(--text2);font-family:'Manrope';font-weight:600;font-size:12.5px;display:flex;align-items:center;gap:7px;cursor:pointer")}><Ico size={14} sw={2.2} paths={I.plus} />Добавить запчасть</button>
              </div>

              {/* paint row */}
              {g.paint && (
                <div style={css('padding:14px 18px;border-top:1px solid var(--line);background:color-mix(in srgb,var(--brand) 3%,transparent);display:flex;align-items:center;gap:14px;flex-wrap:wrap')}>
                  <div style={css('display:flex;align-items:center;gap:10px;flex:0 0 auto')}>
                    <span style={g.paint.swatchStyle} />
                    <div>
                      <div style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)")}>Подготовка краски</div>
                      <div style={css('font-weight:700;font-size:14px;margin-top:1px')}>Окрасные работы</div>
                    </div>
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:3px')}>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Код цвета</label>
                    <input value={g.paint.code} onChange={(e) => onPaintCode(g.carId, e.target.value)} placeholder="напр. 202 Чёрный" style={css("width:150px;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;outline:none")} />
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:3px')}>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Тип</label>
                    <input value={g.paint.type} onChange={(e) => onPaintType(g.carId, e.target.value)} list="paint-types" placeholder="База / Металлик" style={css("width:120px;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--text2);font-family:'Manrope';font-size:12.5px;outline:none")} />
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:3px')}>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Объём</label>
                    <input value={g.paint.volume} onChange={(e) => onPaintVolume(g.carId, e.target.value)} placeholder="1.0 кг" style={css("width:80px;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--text2);font-family:'JetBrains Mono',monospace;font-size:12.5px;outline:none")} />
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:3px')}>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Себест., ₽</label>
                    <input value={g.paint.costStr} onChange={(e) => onPaintCost(g.carId, e.target.value)} inputMode="numeric" placeholder="0" style={{ ...css("width:100px;height:34px;padding:0 10px;border-radius:8px;background:var(--panel2);color:var(--text);font-family:'JetBrains Mono',monospace;font-weight:600;font-size:12.5px;text-align:right;outline:none"), border: '1px solid ' + g.paint.costBorder }} />
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:3px;margin-left:auto')}>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text3)")}>Статус</label>
                    <select value={g.paint.status} onChange={(e) => onPaintStatus(g.carId, e.target.value)} style={g.paint.selStyle}>
                      {g.paint.statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <datalist id="supplier-presets">{supplierNames.map((s) => <option key={s} value={s} />)}</datalist>
        <datalist id="paint-types"><option value="База" /><option value="Металлик" /><option value="Эмаль" /><option value="Перламутр" /><option value="2К акрил" /></datalist>
      </div>

      {/* ================= ETA PROMPT ================= */}
      {etaPrompt && (
        <div style={css('position:absolute;inset:0;background:rgba(4,6,9,.68);backdrop-filter:blur(4px);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px')}>
          <div style={css('width:min(420px,94vw);background:var(--panel);border:1px solid var(--line2);border-radius:16px;box-shadow:0 30px 80px -30px #000;overflow:hidden')}>
            <div style={css('padding:20px 22px 16px;border-bottom:1px solid var(--line)')}>
              <div style={css('display:flex;align-items:center;gap:11px')}>
                <span style={css('width:40px;height:40px;border-radius:11px;background:color-mix(in srgb,var(--wait) 15%,transparent);border:1px solid color-mix(in srgb,var(--wait) 40%,transparent);display:flex;align-items:center;justify-content:center;color:var(--wait);flex:0 0 auto')}><Ico size={20} paths={I.clock} /></span>
                <div><div style={css('font-size:16px;font-weight:800')}>Укажите дату доставки</div><div style={css('font-size:12px;color:var(--text3);margin-top:2px')}>Обязательно при статусе «Заказано»</div></div>
              </div>
            </div>
            <div style={css('padding:18px 22px;display:flex;flex-direction:column;gap:14px')}>
              <div style={css('background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:11px 13px')}>
                <div style={css('font-weight:600;font-size:13.5px')}>{etaPrompt.name}</div>
                <div style={css("font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--text3);margin-top:2px")}>{etaPrompt.car} · заказ {etaPrompt.orderedAt}</div>
              </div>
              <div>
                <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Ожидаемая дата (ETA)</label>
                <input value={etaPrompt.draft} onChange={(e) => onEtaDraft(e.target.value)} placeholder="дд.мм — напр. 09.07" autoFocus style={css("width:100%;height:46px;padding:0 14px;border-radius:10px;border:1px solid var(--line2);background:var(--panel2);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:700;outline:none")} />
              </div>
            </div>
            <div style={css('padding:0 22px 20px;display:flex;gap:10px;justify-content:flex-end')}>
              <button onClick={cancelEta} style={css("height:42px;padding:0 18px;border-radius:10px;border:1px solid var(--line2);background:var(--panel);color:var(--text);font-family:'Manrope';font-weight:600;font-size:13.5px;cursor:pointer")}>Отмена</button>
              <button onClick={confirmEta} style={css("height:42px;padding:0 22px;border-radius:10px;border:none;background:var(--wait);color:#170f02;font-family:'Manrope';font-weight:700;font-size:13.5px;cursor:pointer")}>Подтвердить заказ</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ORDER PROMPT ================= */}
      {orderPrompt && (() => {
        const d = orderPrompt.draft || {};
        const missSupplier = !(d.supplier && String(d.supplier).trim());
        const missCost = !(Number(String(d.cost ?? '').replace(/[^\d.-]/g, '')) > 0);
        const isAnalog = d.kind === 'analog' || d.kind === 'analog_orig';
        const showErr = !!orderPrompt.showErr;
        const border = (miss) => showErr && miss ? '1px solid var(--delay)' : (miss ? '1px solid color-mix(in srgb,var(--wait) 55%,transparent)' : '1px solid var(--line2)');
        const bg = (miss) => showErr && miss ? 'color-mix(in srgb,var(--delay) 9%,var(--panel2))' : (miss ? 'color-mix(in srgb,var(--wait) 8%,var(--panel2))' : 'var(--panel2)');
        const canSave = !missSupplier && !missCost;
        const fieldBase = "width:100%;height:40px;padding:0 12px;border-radius:9px;color:var(--text);outline:none";
        return (
          <div style={css('position:absolute;inset:0;background:rgba(4,6,9,.68);backdrop-filter:blur(4px);z-index:61;display:flex;align-items:center;justify-content:center;padding:24px')}>
            <div style={css('width:min(520px,95vw);max-height:92%;background:var(--panel);border:1px solid var(--line2);border-radius:16px;box-shadow:0 30px 80px -30px #000;overflow:hidden;display:flex;flex-direction:column')}>
              <div style={css('flex:0 0 auto;padding:20px 22px 16px;border-bottom:1px solid var(--line)')}>
                <div style={css('display:flex;align-items:center;gap:11px')}>
                  <span style={css('width:40px;height:40px;border-radius:11px;background:color-mix(in srgb,var(--wait) 15%,transparent);border:1px solid color-mix(in srgb,var(--wait) 40%,transparent);display:flex;align-items:center;justify-content:center;color:var(--wait);flex:0 0 auto')}><Ico size={20} paths={I.cart} /></span>
                  <div><div style={css('font-size:16px;font-weight:800')}>Оформление заказа</div><div style={css('font-size:12px;color:var(--text3);margin-top:2px')}>Заполните обязательные поля, чтобы перевести деталь в «Заказано»</div></div>
                </div>
              </div>
              <div style={css('flex:1 1 auto;overflow-y:auto;min-height:0;padding:18px 22px;display:flex;flex-direction:column;gap:15px')}>
                <div style={css('background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:11px 13px')}>
                  <div style={css('font-weight:600;font-size:13.5px')}>{orderPrompt.name}</div>
                  <div style={css("font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--text3);margin-top:2px")}>{orderPrompt.car}</div>
                </div>
                <div>
                  <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Наименование</label>
                  <input value={d.name || ''} onChange={(e) => onOrderDraft('name', e.target.value)} placeholder="название детали" style={{ ...css(fieldBase), border: '1px solid var(--line2)', background: 'var(--panel2)', fontFamily: "'Manrope'", fontSize: '13.5px' }} />
                </div>
                <div style={css('display:grid;grid-template-columns:1fr 88px;gap:12px')}>
                  <div>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Тип запчасти</label>
                    <select value={d.kind || 'new'} onChange={(e) => onOrderDraft('kind', e.target.value)} style={{ ...css(fieldBase + ";appearance:none;-webkit-appearance:none;cursor:pointer"), border: '1px solid var(--line2)', background: 'var(--panel2)', fontFamily: "'Manrope'", fontSize: '13px' }}>
                      {[['new', 'Новое'], ['used', 'Б/У'], ['used_orig', 'Б/У под ориг.'], ['analog', 'Замена'], ['analog_orig', 'Аналог под ориг.']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Кол-во</label>
                    <input value={d.qty ?? 1} onChange={(e) => onOrderDraft('qty', e.target.value)} inputMode="numeric" style={{ ...css(fieldBase + ";text-align:center"), border: '1px solid var(--line2)', background: 'var(--panel2)', fontFamily: "'JetBrains Mono',monospace", fontSize: '14px' }} />
                  </div>
                </div>
                <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                  <div>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Артикул (ориг.)</label>
                    <input value={d.article || ''} onChange={(e) => onOrderDraft('article', e.target.value)} placeholder="—" style={{ ...css(fieldBase), border: '1px solid var(--line2)', background: 'var(--panel2)', fontFamily: "'JetBrains Mono',monospace", fontSize: '13px' }} />
                  </div>
                  {isAnalog && (
                    <div>
                      <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--brand);margin-bottom:6px;display:block")}>Артикул аналога</label>
                      <input value={d.replArticle || ''} onChange={(e) => onOrderDraft('replArticle', e.target.value)} placeholder="—" style={{ ...css(fieldBase), border: '1px solid color-mix(in srgb,var(--brand) 32%,transparent)', background: 'color-mix(in srgb,var(--brand) 7%,transparent)', color: 'var(--brand)', fontFamily: "'JetBrains Mono',monospace", fontSize: '13px' }} />
                    </div>
                  )}
                </div>
                <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                  <div>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:flex;align-items:center;gap:5px")}>Поставщик <span style={{ color: 'var(--wait)' }}>*</span></label>
                    <input value={d.supplier || ''} onChange={(e) => onOrderDraft('supplier', e.target.value)} list="supplier-presets" placeholder="напр. Exist" style={{ ...css(fieldBase), border: border(missSupplier), background: bg(missSupplier), fontFamily: "'Manrope'", fontSize: '13.5px' }} />
                  </div>
                  <div>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:flex;align-items:center;gap:5px")}>Себест., ₽/шт <span style={{ color: 'var(--wait)' }}>*</span></label>
                    <input value={d.cost ?? ''} onChange={(e) => onOrderDraft('cost', e.target.value)} inputMode="numeric" placeholder="0" style={{ ...css(fieldBase + ";text-align:right"), border: border(missCost), background: bg(missCost), fontFamily: "'JetBrains Mono',monospace", fontSize: '14px' }} />
                  </div>
                </div>
                <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
                  <div>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Цена по ЗН, ₽/шт</label>
                    <input value={d.price ?? ''} onChange={(e) => onOrderDraft('price', e.target.value)} inputMode="numeric" placeholder="0" style={{ ...css(fieldBase + ";text-align:right"), border: '1px solid var(--line2)', background: 'var(--panel2)', fontFamily: "'JetBrains Mono',monospace", fontSize: '14px' }} />
                  </div>
                  <div>
                    <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Дата доставки (ETA)</label>
                    <input value={d.eta || ''} onChange={(e) => onOrderDraft('eta', e.target.value)} placeholder="дд.мм" style={{ ...css(fieldBase), border: '1px solid var(--line2)', background: 'var(--panel2)', fontFamily: "'JetBrains Mono',monospace", fontSize: '14px' }} />
                  </div>
                </div>
                {showErr && (
                  <div style={css('display:flex;gap:9px;align-items:flex-start;background:color-mix(in srgb,var(--delay) 10%,transparent);border:1px solid color-mix(in srgb,var(--delay) 40%,transparent);border-radius:10px;padding:10px 12px;color:var(--delay);font-size:12px;line-height:1.45')}>
                    <Ico size={15} sw={2} style={{ flex: '0 0 auto', marginTop: '1px' }} paths={I.alert} />
                    <span>Укажите поставщика и себестоимость — без них нельзя оформить заказ.</span>
                  </div>
                )}
              </div>
              <div style={css('flex:0 0 auto;padding:16px 22px 20px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end')}>
                <button onClick={cancelOrder} style={css("height:42px;padding:0 18px;border-radius:10px;border:1px solid var(--line2);background:var(--panel);color:var(--text);font-family:'Manrope';font-weight:600;font-size:13.5px;cursor:pointer")}>Отмена</button>
                <button onClick={confirmOrder} style={{ height: '42px', padding: '0 22px', borderRadius: '10px', border: 'none', fontFamily: "'Manrope'", fontWeight: 700, fontSize: '13.5px', cursor: canSave ? 'pointer' : 'not-allowed', background: canSave ? 'var(--wait)' : 'color-mix(in srgb,var(--wait) 32%,var(--panel2))', color: canSave ? '#170f02' : 'var(--text3)' }}>Оформить заказ</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================= REPL (analog) PROMPT ================= */}
      {replPrompt && (() => {
        const isOrig = replPrompt.kind === 'analog_orig';
        const noteBox = { display: 'flex', gap: '9px', alignItems: 'flex-start', fontSize: '11.5px', lineHeight: 1.45, borderRadius: '10px', padding: '10px 12px', color: isOrig ? 'var(--text2)' : 'var(--text3)', background: isOrig ? 'color-mix(in srgb,var(--wait) 9%,transparent)' : 'var(--panel2)', border: '1px solid ' + (isOrig ? 'color-mix(in srgb,var(--wait) 32%,transparent)' : 'var(--line)') };
        const note = isOrig ? 'Номера сохраняются только для внутреннего контроля. В заказ-наряде и акте деталь проходит как оригинал — замена НЕ отображается.' : 'В заказ-наряде и акте отразится установка аналога с указанием обоих номеров.';
        return (
          <div style={css('position:absolute;inset:0;background:rgba(4,6,9,.68);backdrop-filter:blur(4px);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px')}>
            <div style={css('width:min(440px,94vw);background:var(--panel);border:1px solid var(--line2);border-radius:16px;box-shadow:0 30px 80px -30px #000;overflow:hidden')}>
              <div style={css('padding:20px 22px 16px;border-bottom:1px solid var(--line)')}>
                <div style={css('display:flex;align-items:center;gap:11px')}>
                  <span style={css('width:40px;height:40px;border-radius:11px;background:color-mix(in srgb,var(--brand) 15%,transparent);border:1px solid color-mix(in srgb,var(--brand) 40%,transparent);display:flex;align-items:center;justify-content:center;color:var(--brand);flex:0 0 auto')}><Ico size={20} paths={I.swap} /></span>
                  <div><div style={css('font-size:16px;font-weight:800')}>Установка аналога</div><div style={css('font-size:12px;color:var(--text3);margin-top:2px')}>Тип: {replPrompt.kindLabel} · внесите артикулы</div></div>
                </div>
              </div>
              <div style={css('padding:18px 22px;display:flex;flex-direction:column;gap:14px')}>
                <div style={css('background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:11px 13px')}>
                  <div style={css('font-weight:600;font-size:13.5px')}>{replPrompt.name}</div>
                  <div style={css("font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--text3);margin-top:2px")}>{replPrompt.car}</div>
                </div>
                <div>
                  <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px;display:block")}>Оригинальный артикул (OEM)</label>
                  <input value={replPrompt.draftOrig || ''} onChange={(e) => onReplDraft('draftOrig', e.target.value)} placeholder="напр. 81150-33" style={css("width:100%;height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--line2);background:var(--panel2);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:600;outline:none")} />
                  <div style={css('font-size:11px;color:var(--text3);margin-top:5px')}>Сохраняется — деталь-оригинал, взамен которой ставится аналог</div>
                </div>
                <div>
                  <label style={css("font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--brand);margin-bottom:6px;display:block")}>Артикул аналога / заменителя</label>
                  <input value={replPrompt.draftRepl || ''} onChange={(e) => onReplDraft('draftRepl', e.target.value)} placeholder="напр. DEPO 212-11N9" autoFocus style={css("width:100%;height:44px;padding:0 14px;border-radius:10px;border:1px solid color-mix(in srgb,var(--brand) 45%,transparent);background:color-mix(in srgb,var(--brand) 7%,transparent);color:var(--brand);font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;outline:none")} />
                </div>
                <div style={noteBox}>
                  <Ico size={15} stroke={isOrig ? 'var(--wait)' : 'var(--text3)'} style={{ flex: '0 0 auto', marginTop: '1px' }} paths={I.info} />
                  <span>{note}</span>
                </div>
              </div>
              <div style={css('padding:0 22px 20px;display:flex;gap:10px;justify-content:flex-end')}>
                <button onClick={cancelRepl} style={css("height:42px;padding:0 18px;border-radius:10px;border:1px solid var(--line2);background:var(--panel);color:var(--text);font-family:'Manrope';font-weight:600;font-size:13.5px;cursor:pointer")}>Отмена</button>
                <button onClick={confirmRepl} style={css("height:42px;padding:0 22px;border-radius:10px;border:none;background:var(--brand);color:#04141a;font-family:'Manrope';font-weight:700;font-size:13.5px;cursor:pointer")}>Сохранить</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
