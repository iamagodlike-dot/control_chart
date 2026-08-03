import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import Icon from './Icon';
import { useModalEscape } from '../modalEscape';

const DEFAULT_CONFIG = { zones: [{ id: 'A', label: 'Зона A', rows: 4, cols: 6 }], staleDays: 7 };

function cellId(zoneId, row, col) {
  return `${zoneId}-${String(row + 1).padStart(2, '0')}-${String(col + 1).padStart(2, '0')}`;
}

function parseCellId(id, config) {
  const m = id.match(/^(.+)-(\d+)-(\d+)$/);
  if (!m) return null;
  const zone = config.zones.find((z) => z.id === m[1]);
  if (!zone) return null;
  return { zone, row: +m[2] - 1, col: +m[3] - 1 };
}

function daysOpen(openedAt) {
  if (!openedAt) return 0;
  const [d, mo, y] = openedAt.split('.').map(Number);
  if (!d || !mo || !y) return 0;
  return Math.floor((Date.now() - new Date(y, mo - 1, d).getTime()) / 86400000);
}

export default function Warehouse({ onOpenJob }) {
  const [cells, setCells] = useState({});
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState('grid');
  const [modal, setModal] = useState(null);
  const [printCell, setPrintCell] = useState(null);
  const [archiveCell, setArchiveCell] = useState(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newZone, setNewZone] = useState({ label: '', rows: 3, cols: 5, customId: '' });
  const [labelModal, setLabelModal] = useState(null);
  const [logEntries, setLogEntries] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const pollRef = useRef(null);
  const urlOpenedRef = useRef(false);

  const loadAll = async () => {
    try {
      const [cfg, cls] = await Promise.all([api.warehouseConfig.get(), api.cells.list()]);
      if (cfg) setConfig(cfg);
      setCells(cls);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadLog = async () => {
    setLogLoading(true);
    try { setLogEntries(await api.warehouseLog.list()); } catch (e) { console.error(e); }
    setLogLoading(false);
  };

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(loadAll, 8000);
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    if (view === 'log') loadLog();
  }, [view]);

  useEffect(() => {
    if (loading || urlOpenedRef.current) return;
    urlOpenedRef.current = true;
    const cellParam = new URLSearchParams(window.location.search).get('cell');
    if (!cellParam) return;
    const parsed = parseCellId(cellParam, config);
    if (parsed) openCell(cellParam, parsed.zone, parsed.row, parsed.col);
  }, [loading]);

  const saveConfig = async (cfg) => {
    setConfig(cfg);
    setSyncing(true);
    await api.warehouseConfig.save(cfg);
    setSyncing(false);
  };

  const saveCell = async (id, data) => {
    const updated = { ...data, openedAt: data.openedAt || new Date().toLocaleDateString('ru-RU') };
    setCells((prev) => ({ ...prev, [id]: updated }));
    setModal(null);
    setSyncing(true);
    await api.cells.save(id, updated);
    await api.warehouseLog.add('Изменена', id, `${updated.car || '—'} · ${updated.orderNum || '—'}`);
    setSyncing(false);
  };

  const freeCell = async (id) => {
    if (!cells[id]) return;
    setModal(null);
    setArchiveCell(null);
    setSyncing(true);
    const updated = await api.cells.free(id);
    if (updated) setCells((prev) => ({ ...prev, [id]: updated }));
    setSyncing(false);
  };

  const linkJobToCell = async (id, job) => {
    setModal(null);
    setSyncing(true);
    await api.warehouse.addJobCell(id, job);
    await loadAll();
    setSyncing(false);
  };

  const openCell = (id, zone, row, col) => {
    setModal({ id, zone, row, col, cell: cells[id] || null });
  };

  const allCells = config.zones.flatMap((z) =>
    Array.from({ length: z.rows }, (_, r) =>
      Array.from({ length: z.cols }, (_, c) => {
        const id = cellId(z.id, r, c);
        return { id, zone: z, row: r, col: c, data: cells[id] };
      })
    ).flat()
  );

  const occupied = allCells.filter((c) => c.data?.orderNum).length;
  const total = allCells.length;
  const filtered = search.trim()
    ? allCells.filter((c) => {
        const s = search.toLowerCase();
        return c.id.toLowerCase().includes(s) ||
          c.data?.car?.toLowerCase().includes(s) ||
          c.data?.orderNum?.toLowerCase().includes(s) ||
          c.data?.parts?.some((p) => p.name?.toLowerCase().includes(s) || p.code?.toLowerCase().includes(s));
      })
    : [];

  if (loading) return (
    <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'var(--color-bg)' }}>
      <div style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: 2, fontSize: 13, textTransform: 'uppercase' }}>Загрузка склада…</div>
    </div>
  );

  return (
    <div className="wh">
      <div className="wh-toolbar">
        <div className="row-mode-toggle">
          {[['grid', 'Схема'], ['stats', 'Статистика'], ['search', 'Поиск'], ['labels', 'Печать'], ['log', 'Журнал']].map(([key, label]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {syncing && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>сохранение…</span>}
          <span className="wh-count"><b style={{ color: occupied > 0 ? 'var(--status-queued)' : 'var(--status-done)', fontWeight: 700 }}>{occupied}</b> / {total} занято</span>
          <button className="icon-btn" onClick={loadAll} title="Обновить данные"><Icon name="refresh" size={16} /></button>
          <button onClick={() => setConfigOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="gear" size={15} />Настройки склада</button>
        </div>
      </div>

      <div className="wh-body">
        {view === 'grid' && <GridView config={config} cells={cells} onOpen={openCell} />}
        {view === 'search' && <SearchView allCells={allCells} search={search} setSearch={setSearch} filtered={filtered} onOpen={openCell} onArchive={setArchiveCell} />}
        {view === 'stats' && <StatsView config={config} allCells={allCells} onOpen={openCell} />}
        {view === 'labels' && <LabelsView config={config} cells={cells} onPrint={setPrintCell} onLabelPrint={setLabelModal} />}
        {view === 'log' && <LogView entries={logEntries} loading={logLoading} onRefresh={loadLog} />}
      </div>

      {modal && <CellModal modal={modal} onSave={saveCell} onFree={freeCell} onArchive={setArchiveCell} onClose={() => setModal(null)} onOpenJob={onOpenJob} onLinkJob={linkJobToCell} />}
      {printCell && <PrintSheet cell={printCell} cells={cells} onClose={() => setPrintCell(null)} />}
      {archiveCell && <ArchiveModal cellId={archiveCell} cells={cells} onFree={freeCell} onClose={() => setArchiveCell(null)} />}
      {configOpen && <ConfigModal config={config} setConfig={saveConfig} cells={cells} newZone={newZone} setNewZone={setNewZone} onClose={() => setConfigOpen(false)} />}
      {labelModal && <LabelPrintModal zone={labelModal} onClose={() => setLabelModal(null)} />}
    </div>
  );
}

// Reusable cell-grid picker used from CarCard to assign one
// or more warehouse cells to a job without opening the full cell-editing
// modal. Cells toggle in/out of the selection; nothing is saved until
// "Сохранить" is pressed.
export function CellPickerModal({ currentCellIds = [], onSave, onClose }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [cells, setCells] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(currentCellIds);

  useEffect(() => {
    (async () => {
      const [cfg, cls] = await Promise.all([api.warehouseConfig.get(), api.cells.list()]);
      if (cfg) setConfig(cfg);
      setCells(cls);
      setLoading(false);
    })();
  }, []);

  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Клик мимо окна не закрывает — иначе набранный выбор ячеек пропадает от
  // случайного касания рядом (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div ref={backdropRef} className="wh-modal" style={{ zIndex: 1050 }}>
      <div className="wh-modal-card" style={{ maxWidth: 720 }}>
        <div className="wh-modal-head">
          <span style={{ fontWeight: 600 }}>Выбор ячеек склада</span>
          <span style={{ color: 'var(--text3)', fontSize: 12 }}>можно выбрать несколько</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="wh-close">×</button>
        </div>
        <div className="wh-modal-body">
          {loading ? (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>Загрузка…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              {config.zones.map((zone) => (
                <div key={zone.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span className="wh-zone-chip">{zone.id}</span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{zone.label}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${zone.cols}, minmax(0, 1fr))`, gap: 6 }}>
                    {Array.from({ length: zone.rows }, (_, r) =>
                      Array.from({ length: zone.cols }, (_, c) => {
                        const id = cellId(zone.id, r, c);
                        const data = cells[id];
                        const isSelected = selected.includes(id);
                        const isOccupied = data?.orderNum && !isSelected;
                        const clr = isSelected ? 'var(--color-primary)' : isOccupied ? 'var(--status-queued)' : 'var(--status-done)';
                        return (
                          <button
                            key={id}
                            disabled={isOccupied}
                            onClick={() => toggle(id)}
                            title={isOccupied ? `Занята: ${data.car || ''} · ${data.orderNum || ''}` : undefined}
                            style={{
                              border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--line2)'}`,
                              borderLeft: `3px solid ${clr}`,
                              background: isSelected ? 'var(--brand-soft)' : 'var(--color-surface)',
                              borderRadius: 6, padding: '8px 4px', cursor: isOccupied ? 'not-allowed' : 'pointer',
                              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                              color: clr,
                              opacity: isOccupied ? 0.55 : 1,
                            }}
                          >{id}{isSelected && ' ✓'}</button>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="wh-modal-foot" style={{ justifyContent: 'flex-start' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)', flex: 1 }}>
            {selected.length ? `Выбрано: ${selected.join(', ')}` : 'Ничего не выбрано'}
          </span>
          <button onClick={onClose}>Отмена</button>
          <button onClick={() => { onSave(selected); onClose(); }} className="primary">Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function GridView({ config, cells, onOpen }) {
  const staleDays = config.staleDays || 7;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.25rem' }}>
      <div className="wh-legend">
        <span className="wh-legend-item"><i style={{ background: 'var(--status-done)' }} />Свободна</span>
        <span className="wh-legend-item"><i style={{ background: 'var(--status-queued)' }} />Занята</span>
        <span className="wh-legend-item"><i style={{ background: 'var(--status-delayed)' }} />Зависла</span>
      </div>
      {config.zones.map((zone) => {
        const cap = zone.rows * zone.cols;
        let occ = 0;
        for (let r = 0; r < zone.rows; r++) for (let c = 0; c < zone.cols; c++) if (cells[cellId(zone.id, r, c)]?.orderNum) occ++;
        return (
          <div key={zone.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '1rem' }}>
              <span className="wh-zone-chip">{zone.id}</span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{zone.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text3)' }}>{zone.rows}×{zone.cols}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)' }}>{occ} / {cap} занято</span>
            </div>
            <div className="wh-grid" style={{ gridTemplateColumns: `repeat(${zone.cols}, minmax(0, 1fr))` }}>
              {Array.from({ length: zone.rows }, (_, r) =>
                Array.from({ length: zone.cols }, (_, c) => {
                  const id = cellId(zone.id, r, c);
                  const data = cells[id];
                  const isOccupied = data?.orderNum;
                  const isStale = isOccupied && daysOpen(data.openedAt) >= staleDays;
                  const statusColor = isStale ? 'var(--status-delayed)' : 'var(--status-queued)';
                  return (
                    <button key={id} onClick={() => onOpen(id, zone, r, c)} className={`wh-cell${isStale ? ' is-stale' : ''}`} style={{
                      border: isOccupied ? '1px solid var(--line2)' : '1px solid var(--color-border)',
                      borderLeft: isOccupied ? `3px solid ${statusColor}` : '1px solid var(--color-border)',
                      background: isOccupied ? 'var(--color-surface)' : 'color-mix(in srgb, var(--color-surface) 45%, transparent)',
                    }}>
                      <div className="wh-cell-num" style={{ color: isOccupied ? statusColor : 'var(--text3)' }}>
                        {isStale && <Icon name="warning" size={12} strokeWidth={1.9} />}{id}
                      </div>
                      {isOccupied ? (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.car}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{data.orderNum}</div>
                          <div style={{ fontSize: 10.5, color: isStale ? 'var(--status-delayed)' : 'var(--text3)', marginTop: 2 }}>{data.parts?.length || 0} дет. · {daysOpen(data.openedAt)} дн.</div>
                        </>
                      ) : (
                        <div className="wh-cell-free-tag"><i />свободна</div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatsView({ config, allCells, onOpen }) {
  const staleDays = config.staleDays || 7;
  const zoneStats = config.zones.map((z) => {
    const zCells = allCells.filter((c) => c.zone.id === z.id);
    const occ = zCells.filter((c) => c.data?.orderNum);
    return { zone: z, total: zCells.length, occupied: occ.length };
  });
  const occupiedCells = allCells.filter((c) => c.data?.orderNum);
  const avgDays = occupiedCells.length
    ? Math.round(occupiedCells.reduce((s, c) => s + daysOpen(c.data.openedAt), 0) / occupiedCells.length)
    : 0;
  const staleCells = occupiedCells
    .filter((c) => daysOpen(c.data.openedAt) >= staleDays)
    .sort((a, b) => daysOpen(b.data.openedAt) - daysOpen(a.data.openedAt));

  return (
    <div className="wh-list">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: '2rem' }}>
        <div className="wh-metric">
          <div className="wh-metric-label">Занято ячеек</div>
          <div className="wh-metric-value">{occupiedCells.length} <span style={{ fontSize: 15, color: 'var(--text3)', fontWeight: 400 }}>/ {allCells.length}</span></div>
        </div>
        <div className="wh-metric">
          <div className="wh-metric-label">Средний срок хранения</div>
          <div className="wh-metric-value">{avgDays} <span style={{ fontSize: 15, color: 'var(--text3)', fontWeight: 400 }}>дн.</span></div>
        </div>
        <div className={`wh-metric${staleCells.length ? ' is-alert' : ''}`}>
          <div className="wh-metric-label">Зависших (&gt;{staleDays} дн.)</div>
          <div className="wh-metric-value">{staleCells.length}</div>
        </div>
      </div>

      <div className="wh-section-title">По зонам</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '2rem' }}>
        {zoneStats.map(({ zone, total, occupied }) => {
          const pct = total ? Math.round((occupied / total) * 100) : 0;
          return (
            <div key={zone.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span className="wh-zone-chip" style={{ fontSize: 12, padding: '2px 10px' }}>{zone.id}</span>
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{zone.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)' }}>{occupied} / {total} ({pct}%)</span>
              </div>
              <div style={{ height: 6, background: 'var(--color-surface-alt)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? 'var(--status-delayed)' : pct >= 50 ? 'var(--status-queued)' : 'var(--color-primary)' }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="wh-section-title">Зависшие ячейки</div>
      {staleCells.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Нет ячеек с превышением срока хранения</div>
      ) : (
        staleCells.map(({ id, zone, row, col, data }) => (
          <div key={id} onClick={() => onOpen(id, zone, row, col)} className="wh-row is-click is-stale">
            <div className="wh-chip" style={{ background: 'color-mix(in srgb, var(--status-delayed) 16%, transparent)', color: 'var(--status-delayed)' }}>{id}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{data.car} · {data.orderNum}</div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Открыта: {data.openedAt}</div>
            </div>
            <div style={{ color: 'var(--status-delayed)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{daysOpen(data.openedAt)} дн.</div>
          </div>
        ))
      )}
    </div>
  );
}

function LogView({ entries, loading, onRefresh }) {
  return (
    <div className="wh-list">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Последние действия на складе</div>
        <div style={{ flex: 1 }} />
        <button onClick={onRefresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="refresh" size={15} />Обновить</button>
      </div>
      {loading ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Загрузка…</div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 13 }}>Журнал пуст</div>
      ) : (
        entries.map((e, i) => {
          const pillColor = e.action === 'Освобождена' ? 'var(--status-done)' : 'var(--status-queued)';
          return (
            <div key={i} className="wh-row">
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>{new Date(e.ts).toLocaleString('ru-RU')}</div>
              <div className="wh-chip" style={{ fontSize: 12, background: `color-mix(in srgb, ${pillColor} 16%, transparent)`, color: pillColor }}>{e.action}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{e.cellId}</div>
              <div style={{ flex: 1, fontSize: 13, color: 'var(--color-text-muted)' }}>{e.details}</div>
            </div>
          );
        })
      )}
    </div>
  );
}

function SearchView({ allCells, search, setSearch, filtered, onOpen, onArchive }) {
  const occupied = allCells.filter((c) => c.data?.orderNum);
  return (
    <div className="wh-list">
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', display: 'flex' }}><Icon name="search" size={16} strokeWidth={1.8} /></span>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по ячейке, авто, заказ-наряду, детали, артикулу…"
          style={{ width: '100%', padding: '12px 16px 12px 40px', fontSize: 14, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 8, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
      </div>
      {search.trim() ? (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 }}>Найдено: {filtered.length}</div>
          {filtered.map(({ id, zone, row, col, data }) => (
            <SearchRow key={id} id={id} zone={zone} row={row} col={col} data={data} onOpen={onOpen} onArchive={onArchive} />
          ))}
        </div>
      ) : (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="wh-section-title">Занятые ячейки ({occupied.length})</div>
          {occupied.map(({ id, zone, row, col, data }) => (
            <SearchRow key={id} id={id} zone={zone} row={row} col={col} data={data} onOpen={onOpen} onArchive={onArchive} />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchRow({ id, zone, row, col, data, onOpen, onArchive }) {
  const isOccupied = data?.orderNum;
  return (
    <div onClick={() => onOpen(id, zone, row, col)} className={`wh-row is-click${isOccupied ? ' is-occupied' : ''}`}>
      <div className="wh-chip" style={{ background: isOccupied ? 'color-mix(in srgb, var(--status-queued) 16%, transparent)' : 'color-mix(in srgb, var(--status-done) 16%, transparent)', color: isOccupied ? 'var(--status-queued)' : 'var(--status-done)' }}>{id}</div>
      {isOccupied ? (
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{data.car} · {data.orderNum}</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{data.parts?.map((p) => p.name).filter(Boolean).join(', ')} · мастер: {data.master || '—'}</div>
        </div>
      ) : <div style={{ color: 'var(--text3)', fontSize: 13, flex: 1 }}>свободна</div>}
      <button onClick={(e) => { e.stopPropagation(); onArchive(id); }} style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 10px' }}>Архив</button>
    </div>
  );
}

function LabelsView({ config, cells, onPrint, onLabelPrint }) {
  return (
    <div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: '1.5rem' }}>Распечатайте лист ячейки или этикетки для склада</div>
      {config.zones.map((zone) => (
        <div key={zone.id} style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span className="wh-zone-chip">{zone.id}</span>
            <span style={{ fontWeight: 600 }}>{zone.label}</span>
            <button onClick={() => onLabelPrint(zone)} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="receipt" size={15} />Этикетки зоны</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {Array.from({ length: zone.rows }, (_, r) =>
              Array.from({ length: zone.cols }, (_, c) => {
                const id = cellId(zone.id, r, c);
                const data = cells[id];
                const isOccupied = data?.orderNum;
                return (
                  <div key={id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, background: 'var(--color-surface)' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>{id}</div>
                    {isOccupied && <div style={{ fontSize: 11, color: 'var(--color-text)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.car}</div>}
                    <button onClick={() => onPrint({ id, zone, row: r, col: c })} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', fontSize: 11 }}>
                      <Icon name="file" size={13} />{isOccupied ? 'Лист ячейки' : 'Пустой лист'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const inputSt = { border: '1px solid var(--color-border)', borderRadius: 6, padding: '7px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', background: 'var(--color-surface-alt)', color: 'var(--color-text)', fontFamily: 'inherit' };

function CellModal({ modal, onSave, onFree, onArchive, onClose, onOpenJob, onLinkJob }) {
  const { id, cell } = modal;
  const isOccupied = cell?.orderNum;
  const isLinked = !!cell?.job_id;
  const [form, setForm] = useState({
    car: cell?.car || '', plate: cell?.plate || '', orderNum: cell?.orderNum || '',
    master: cell?.master || '', openedAt: cell?.openedAt || new Date().toLocaleDateString('ru-RU'),
    notes: cell?.notes || '', parts: cell?.parts || [{ name: '', code: '', qty: 1 }],
    _archive: cell?._archive || [], job_id: cell?.job_id,
  });
  const [linkQuery, setLinkQuery] = useState('');
  const [jobOptions, setJobOptions] = useState(null);

  useEffect(() => {
    if (isOccupied || !onLinkJob) return;
    api.jobs.list().then((jobs) => setJobOptions(jobs.filter((j) => !j.archived)));
  }, [isOccupied]);

  const linkMatches = (jobOptions || []).filter((j) => {
    if (!linkQuery.trim()) return true;
    const q = linkQuery.toLowerCase();
    return [j.car_model, j.plate_number, j.order_number].some((v) => (v || '').toLowerCase().includes(q));
  }).slice(0, 20);

  const setPart = (i, field, val) => setForm((f) => { const parts = [...f.parts]; parts[i] = { ...parts[i], [field]: val }; return { ...f, parts }; });
  const addPart = () => setForm((f) => ({ ...f, parts: [...f.parts, { name: '', code: '', qty: 1 }] }));
  const removePart = (i) => setForm((f) => ({ ...f, parts: f.parts.filter((_, idx) => idx !== i) }));

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик по подложке, и окно схлопывалось само (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div ref={backdropRef} className="wh-modal" style={{ zIndex: 1000 }}>
      <div className="wh-modal-card" style={{ maxWidth: 640 }}>
        <div className="wh-modal-head">
          <div className="wh-modal-title" style={{ fontSize: 18 }}>{id}</div>
          <div style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: 13 }}>{isOccupied ? `${form.car} · ${form.orderNum}` : 'Свободна'}</div>
          {isOccupied && <button onClick={() => onArchive(id)} style={{ fontSize: 12, padding: '4px 12px' }}>История</button>}
          <button onClick={onClose} className="wh-close">×</button>
        </div>
        <div className="wh-modal-body">
          {isLinked && (
            <div style={{ background: 'var(--brand-soft)', border: '1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>Привязана к заказ-наряду в диспетчерской — авто, номер и запчасти обновятся автоматически при изменении заказа.</span>
              {onOpenJob && (
                <button
                  onClick={() => { onOpenJob(cell.job_id); onClose(); }}
                  className="primary"
                  style={{ padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                >
                  Открыть заказ-наряд →
                </button>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[['car', 'Автомобиль', 'Toyota Camry 2020'], ['plate', 'Гос. номер', 'А 123 ВС 77'], ['orderNum', 'Заказ-наряд №', 'ЗН-2025-0847'], ['master', 'Мастер-приёмщик', 'Петров И.В.']].map(([field, label, ph]) => {
              // car / plate / orderNum are mirrored from the linked заказ-наряд and
              // overwritten on every sync — lock them here so edits aren't silently lost.
              // «Мастер-приёмщик» is cell-local, always editable.
              const locked = isLinked && field !== 'master';
              return (
                <div key={field}>
                  <div className="wh-field-label">{label}</div>
                  <input value={form[field]} onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))} placeholder={ph} style={locked ? { ...inputSt, opacity: 0.6, cursor: 'not-allowed' } : inputSt} disabled={locked} title={locked ? 'Обновляется из заказ-наряда' : undefined} />
                </div>
              );
            })}
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="wh-field-label">Примечания</div>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputSt, resize: 'vertical' }} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              ПЕРЕЧЕНЬ ЗАПЧАСТЕЙ
              {!isLinked && <button onClick={addPart} className="primary" style={{ padding: '3px 12px', fontSize: 12 }}>+ добавить</button>}
            </div>
            {isLinked ? (
              form.parts.length === 0
                ? <div style={{ fontSize: 13, color: 'var(--text3)' }}>Список появится из заказ-наряда</div>
                : form.parts.map((p, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 60px', gap: 6, marginBottom: 6, fontSize: 13, color: 'var(--color-text-muted)', padding: '2px 0' }}>
                      <span>{p.name || '—'}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{p.code || '—'}</span>
                      <span>{p.qty ?? 1} шт.</span>
                    </div>
                  ))
            ) : (
              form.parts.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 60px 32px', gap: 6, marginBottom: 6 }}>
                  <input value={p.name} onChange={(e) => setPart(i, 'name', e.target.value)} placeholder="Наименование" style={inputSt} />
                  <input value={p.code} onChange={(e) => setPart(i, 'code', e.target.value)} placeholder="Артикул" style={inputSt} />
                  <input value={p.qty} onChange={(e) => setPart(i, 'qty', e.target.value)} type="number" min="1" style={inputSt} />
                  <button onClick={() => removePart(i)} className="wh-close" style={{ border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 16 }}>×</button>
                </div>
              ))
            )}
          </div>

          {!isOccupied && onLinkJob && (
            <div style={{ marginTop: 20, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)', marginBottom: 8 }}>ПРИВЯЗАТЬ К СУЩЕСТВУЮЩЕМУ ЗАКАЗУ</div>
              <input value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder="Поиск по авто, гос. номеру, № заказа…" style={inputSt} />
              <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 8, border: linkMatches.length ? '1px solid var(--color-border)' : 'none', borderRadius: 6 }}>
                {jobOptions === null && <div style={{ color: 'var(--text3)', fontSize: 12, padding: '8px 4px' }}>Загрузка заказов…</div>}
                {jobOptions !== null && linkMatches.length === 0 && (
                  <div style={{ color: 'var(--text3)', fontSize: 12, padding: '8px 4px' }}>Ничего не найдено</div>
                )}
                {linkMatches.map((j) => (
                  <div
                    key={j.id}
                    onClick={() => onLinkJob(id, j)}
                    className="wh-link-row"
                  >
                    <span>{j.car_model}{j.plate_number ? ` (${j.plate_number})` : ''}</span>
                    <span style={{ color: 'var(--text3)' }}>{j.order_number || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="wh-modal-foot">
          {isOccupied && (
            <button onClick={() => { if (window.confirm('Освободить ячейку?')) onFree(id); }} style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', color: 'var(--color-warning)' }}>Освободить ячейку</button>
          )}
          <button onClick={() => onSave(id, form)} className="primary">Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function ArchiveModal({ cellId: id, cells, onFree, onClose }) {
  const data = cells[id];
  const archive = data?._archive || [];
  const isOccupied = data?.orderNum;
  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик по подложке, и окно схлопывалось само (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div ref={backdropRef} className="wh-modal" style={{ zIndex: 1010 }}>
      <div className="wh-modal-card" style={{ maxWidth: 560, maxHeight: '80vh' }}>
        <div className="wh-modal-head">
          <div className="wh-modal-title" style={{ fontSize: 15 }}>{id}</div>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>История движения</span>
          <div style={{ flex: 1 }} />
          {isOccupied && <button onClick={() => { if (window.confirm('Освободить ячейку?')) onFree(id); }} style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', color: 'var(--color-warning)', fontSize: 12, padding: '5px 12px' }}>Освободить</button>}
          <button onClick={onClose} className="wh-close">×</button>
        </div>
        <div className="wh-modal-body">
          {archive.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 14 }}>История пуста</div>}
          {archive.map((entry, i) => (
            <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 14, marginBottom: 10, background: 'var(--color-surface-alt)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{entry.car} · {entry.orderNum}</span>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{entry.openedAt} → {entry.freedAt}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Мастер: {entry.master || '—'} · {entry.parts?.length || 0} деталей</div>
              {entry.parts?.length > 0 && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)' }}>{entry.parts.map((p) => p.name).filter(Boolean).join(', ')}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConfigModal({ config, setConfig, cells = {}, newZone, setNewZone, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingId, setEditingId] = useState({});
  const [dimDraft, setDimDraft] = useState({}); // `${zoneId}:${field}` -> string being typed

  // Occupied cells (with orderNum) currently sitting inside a zone, with their row/col.
  const occupiedCellsInZone = (zoneId) => {
    const out = [];
    for (const [id, c] of Object.entries(cells)) {
      if (!c?.orderNum) continue;
      const m = id.match(/^(.+)-(\d+)-(\d+)$/);
      if (m && m[1] === zoneId) out.push({ id, row: +m[2] - 1, col: +m[3] - 1 });
    }
    return out;
  };
  const listIds = (arr) => arr.map((o) => o.id).slice(0, 6).join(', ') + (arr.length > 6 ? '…' : '');

  const addZone = () => {
    if (!newZone.label.trim()) return;
    const autoId = newZone.label.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || ('Z' + (config.zones.length + 1));
    const id = (newZone.customId || '').trim().toUpperCase() || autoId;
    if (config.zones.find((z) => z.id === id)) { setNewZone((n) => ({ ...n, _err: 'Индекс уже занят' })); return; }
    setConfig({ ...config, zones: [...config.zones, { id, label: newZone.label, rows: +newZone.rows, cols: +newZone.cols }] });
    setNewZone({ label: '', rows: 3, cols: 5, customId: '', _err: '' });
  };

  const removeZone = (id) => {
    // Deleting a zone would hide any cells still in it — refuse while occupied.
    const occ = occupiedCellsInZone(id);
    if (occ.length) { alert(`Нельзя удалить зону: в ней ${occ.length} занятых ячеек (${listIds(occ)}). Сначала освободите их на складе.`); setConfirmDelete(null); return; }
    setConfig({ ...config, zones: config.zones.filter((z) => z.id !== id) });
    setConfirmDelete(null);
  };

  const updateZone = (id, field, val) => setConfig({ ...config, zones: config.zones.map((z) => (z.id === id ? { ...z, [field]: (field === 'rows' || field === 'cols') ? +val : val } : z)) });

  // rows/cols edit through a draft, committed on blur — so the "would strand
  // occupied cells" guard fires once on commit, not on every keystroke.
  const dimKey = (id, field) => `${id}:${field}`;
  const dimValue = (z, field) => { const k = dimKey(z.id, field); return dimDraft[k] !== undefined ? dimDraft[k] : z[field]; };
  const onDimChange = (id, field, val) => setDimDraft((d) => ({ ...d, [dimKey(id, field)]: val.replace(/\D/g, '').slice(0, 2) }));
  const commitDim = (id, field) => {
    const k = dimKey(id, field);
    setDimDraft((d) => { const n = { ...d }; delete n[k]; return n; });
    const zone = config.zones.find((z) => z.id === id);
    if (!zone) return;
    const next = Math.min(20, Math.max(1, +dimDraft[k] || zone[field]));
    if (next === zone[field]) return;
    if (next < zone[field]) {
      const lost = occupiedCellsInZone(id).filter((o) => (field === 'rows' ? o.row >= next : o.col >= next));
      if (lost.length) { alert(`Нельзя уменьшить зону: за границей окажутся занятые ячейки (${listIds(lost)}). Сначала освободите их.`); return; }
    }
    updateZone(id, field, next);
  };

  const commitIdChange = (oldId) => {
    const newId = (editingId[oldId] || '').trim().toUpperCase();
    if (!newId || newId === oldId) { setEditingId((e) => { const n = { ...e }; delete n[oldId]; return n; }); return; }
    if (config.zones.find((z) => z.id === newId)) return;
    setConfig({ ...config, zones: config.zones.map((z) => (z.id === oldId ? { ...z, id: newId } : z)) });
    setEditingId((e) => { const n = { ...e }; delete n[oldId]; return n; });
  };

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик по подложке, и окно схлопывалось само (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div ref={backdropRef} className="wh-modal" style={{ zIndex: 1020 }}>
      <div className="wh-modal-card" style={{ maxWidth: 560, maxHeight: '85vh' }}>
        <div className="wh-modal-head">
          <span style={{ fontWeight: 600 }}>Настройки склада</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="wh-close">×</button>
        </div>
        <div className="wh-modal-body">
          <div className="wh-field-label" style={{ marginBottom: 10 }}>Зоны хранения</div>
          {config.zones.map((z) => (
            <div key={z.id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 72px 72px 36px', gap: 8, alignItems: 'center' }}>
                <input
                  value={editingId[z.id] !== undefined ? editingId[z.id] : z.id}
                  onChange={(e) => setEditingId((ei) => ({ ...ei, [z.id]: e.target.value.toUpperCase().slice(0, 6) }))}
                  onBlur={() => commitIdChange(z.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  style={{ ...inputSt, fontFamily: 'var(--font-mono)', fontWeight: 700, textAlign: 'center', background: 'var(--brand-soft)', color: 'var(--color-primary)', borderColor: 'color-mix(in srgb, var(--color-primary) 40%, transparent)', letterSpacing: 1, padding: '7px 4px' }}
                />
                <input value={z.label} onChange={(e) => updateZone(z.id, 'label', e.target.value)} style={inputSt} />
                <input type="number" min="1" max="20" value={dimValue(z, 'rows')} onChange={(e) => onDimChange(z.id, 'rows', e.target.value)} onBlur={() => commitDim(z.id, 'rows')} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ ...inputSt, textAlign: 'center' }} title="Рядов" />
                <input type="number" min="1" max="20" value={dimValue(z, 'cols')} onChange={(e) => onDimChange(z.id, 'cols', e.target.value)} onBlur={() => commitDim(z.id, 'cols')} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ ...inputSt, textAlign: 'center' }} title="Столбцов" />
                <button onClick={() => setConfirmDelete(confirmDelete === z.id ? null : z.id)} className="wh-close" style={{ border: '1px solid color-mix(in srgb, var(--status-delayed) 45%, transparent)', borderRadius: 4, color: 'var(--status-delayed)', fontSize: 18, padding: '2px 6px', background: confirmDelete === z.id ? 'color-mix(in srgb, var(--status-delayed) 14%, transparent)' : 'transparent' }}>×</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>Рядов: {z.rows} · Столбцов: {z.cols} · Ячеек: {z.rows * z.cols}</div>
              {confirmDelete === z.id && (
                <div style={{ marginTop: 10, background: 'color-mix(in srgb, var(--status-delayed) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--status-delayed) 40%, transparent)', borderRadius: 6, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--status-delayed)', flex: 1 }}>Удалить зону <b>{z.id}</b>?</span>
                  <button onClick={() => removeZone(z.id)} style={{ background: 'var(--status-delayed)', color: '#fff', border: 'none', fontSize: 13, padding: '5px 14px' }}>Удалить</button>
                  <button onClick={() => setConfirmDelete(null)} style={{ fontSize: 13, padding: '5px 10px' }}>Отмена</button>
                </div>
              )}
            </div>
          ))}
          <div style={{ border: '1px dashed var(--line2)', borderRadius: 8, padding: 12, marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>Добавить зону</div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 72px 72px auto', gap: 8 }}>
              <input value={newZone.customId || ''} onChange={(e) => setNewZone((n) => ({ ...n, customId: e.target.value.toUpperCase().slice(0, 6), _err: '' }))} placeholder="B" maxLength={6} style={{ ...inputSt, fontFamily: 'var(--font-mono)', textAlign: 'center', fontWeight: 600 }} title="Индекс" />
              <input value={newZone.label} onChange={(e) => setNewZone((n) => ({ ...n, label: e.target.value, _err: '' }))} placeholder="Название зоны" style={{ ...inputSt, borderColor: newZone._err ? 'var(--status-delayed)' : undefined }} onKeyDown={(e) => { if (e.key === 'Enter') addZone(); }} />
              <input type="number" min="1" max="20" value={newZone.rows} onChange={(e) => setNewZone((n) => ({ ...n, rows: e.target.value }))} style={{ ...inputSt, textAlign: 'center' }} title="Рядов" />
              <input type="number" min="1" max="20" value={newZone.cols} onChange={(e) => setNewZone((n) => ({ ...n, cols: e.target.value }))} style={{ ...inputSt, textAlign: 'center' }} title="Столбцов" />
              <button onClick={addZone} className="primary" style={{ padding: '7px 16px' }}>+</button>
            </div>
            {newZone._err && <div style={{ fontSize: 12, color: 'var(--status-delayed)', marginTop: 6 }}>{newZone._err}</div>}
          </div>

          <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '1.5rem' }}>
            <div className="wh-field-label" style={{ marginBottom: 10 }}>Зависшие ячейки</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Считать ячейку зависшей через</span>
              <input type="number" min="1" max="90" value={config.staleDays || 7} onChange={(e) => setConfig({ ...config, staleDays: +e.target.value || 1 })} style={{ ...inputSt, width: 64, textAlign: 'center' }} />
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>дн.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const LABEL_SIZES = [
  { id: 'xs', label: 'XS — 40×20 мм', w: 40, h: 20, cols: 5, numPt: 14, qr: false },
  { id: 's', label: 'S — 52×30 мм', w: 52, h: 30, cols: 4, numPt: 18, qr: false },
  { id: 'm', label: 'M — 70×40 мм', w: 70, h: 40, cols: 3, numPt: 22, qr: true },
  { id: 'l', label: 'L — 90×50 мм', w: 90, h: 50, cols: 2, numPt: 28, qr: true },
  { id: 'xl', label: 'XL — 105×74 мм', w: 105, h: 74, cols: 2, numPt: 34, qr: true },
  { id: 'a4', label: 'A4 — 1 этикетка на лист', w: 190, h: 267, cols: 1, numPt: 64, qr: true },
];

function LabelPrintModal({ zone, onClose }) {
  const [sizeId, setSizeId] = useState('s');
  const [printing, setPrinting] = useState(false);
  const cells = Array.from({ length: zone.rows }, (_, r) =>
    Array.from({ length: zone.cols }, (_, c) => cellId(zone.id, r, c))
  ).flat();

  const doPrint = async () => {
    const sz = LABEL_SIZES.find((s) => s.id === sizeId);
    setPrinting(true);
    let qrMap = {};
    if (sz.qr) {
      // quiet-zone margin baked into the PNG so the code stays scannable when shrunk
      for (const id of cells) {
        const url = `${window.location.origin}${window.location.pathname}?cell=${id}`;
        qrMap[id] = await QRCode.toDataURL(url, { margin: 1, width: 300 });
      }
    }
    setPrinting(false);

    const isA4 = sz.id === 'a4';
    const pad = Math.max(2, Math.round(sz.h * 0.07));
    const qrPad = Math.max(1, Math.round(pad * 0.4));
    const qrSizeMm = isA4
      ? Math.round(sz.w * 0.58)
      : Math.round(Math.min(sz.w * 0.36, sz.h - pad * 2) - qrPad * 2);
    const layout = isA4 ? 'column' : 'row';
    const accentSize = Math.max(6, Math.round(Math.min(sz.w, sz.h) * 0.2));
    const logoSize = Math.round(accentSize * 0.74 * 10) / 10;
    const logoUrl = `${window.location.origin}/logo-mark.png`;

    const labelInner = (id) => {
      const qrImg = qrMap[id]
        ? `<div class="qrbox"><img class="qr" src="${qrMap[id]}" width="${qrSizeMm}mm" height="${qrSizeMm}mm" /></div>`
        : '';
      const textBlock = `<div class="text"><div class="zone">${zone.label}</div><div class="top">Ячейка</div><div class="num">${id}</div></div>`;
      const divider = qrMap[id] ? `<div class="divider"></div>` : '';
      const inner = isA4 ? `${textBlock}${divider}${qrImg}` : `${qrImg}${divider}${textBlock}`;
      const accent = `<div class="accent"><img class="logo" src="${logoUrl}" width="${logoSize}mm" height="${logoSize}mm" /></div>`;
      return `${accent}<div class="content">${inner}</div>`;
    };

    const w = window.open('', '_blank');
    const pageBreak = isA4 ? 'page-break-after:always;' : '';
    w.document.write(`<html><head><title>Этикетки ${zone.label}</title><style>
      *{box-sizing:border-box}
      body{margin:0;font-family:'IBM Plex Sans','Helvetica Neue',sans-serif}
      .grid{display:grid;grid-template-columns:repeat(${sz.cols},${sz.w}mm)}
      .label{border:1.5px solid #1a1a1a;width:${sz.w}mm;height:${sz.h}mm;display:flex;flex-direction:${layout};${pageBreak};overflow:hidden}
      .accent{flex-shrink:0;background:#fff;display:flex;align-items:center;justify-content:center;${isA4 ? `width:100%;height:${accentSize}mm;border-bottom:1.5px solid #1a1a1a` : `width:${accentSize}mm;height:100%;border-right:1.5px solid #1a1a1a`}}
      .logo{object-fit:contain}
      .content{flex:1;min-width:0;min-height:0;display:flex;flex-direction:${layout};align-items:center;justify-content:center;gap:${pad * 0.7}mm;padding:${pad}mm}
      .qrbox{background:#fff;border:1px solid #ddd;padding:${qrPad}mm;display:flex;flex-shrink:0;line-height:0}
      .divider{${isA4 ? `width:60%;height:1px;margin:${pad * 0.3}mm 0` : `width:1px;align-self:stretch;margin:${pad * 0.3}mm 0`};background:#e3e3e3}
      .text{display:flex;flex-direction:column;align-items:${isA4 ? 'center' : 'flex-start'};min-width:0}
      .zone{font-size:${Math.round(sz.numPt * 0.32)}pt;color:#aaa;letter-spacing:0.5px;margin-bottom:${Math.max(1, Math.round(sz.numPt * 0.08))}px;font-weight:500}
      .top{font-size:${Math.round(sz.numPt * 0.36)}pt;color:#1a1a1a;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;margin-bottom:${Math.max(2, Math.round(sz.numPt * 0.16))}px;opacity:0.55}
      .num{font-family:'IBM Plex Mono',monospace;font-size:${sz.numPt}pt;font-weight:700;letter-spacing:0.5px;line-height:1;color:#1a1a1a}
      @media print{@page{size:A4;margin:8mm}}
    </style>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@700&display=swap" rel="stylesheet" />
    </head><body><div class="grid">
    ${cells.map((id) => `<div class="label">${labelInner(id)}</div>`).join('')}
    </div><script>window.print();</script></body></html>`);
    w.document.close();
  };

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик по подложке, и окно схлопывалось само (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div ref={backdropRef} className="wh-modal" style={{ zIndex: 1030 }}>
      <div className="wh-modal-card" style={{ maxWidth: 420, width: '90%', padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--color-primary)', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Icon name="receipt" size={34} /></div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Печать этикеток</div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: '1.5rem' }}>{zone.label} · {zone.rows * zone.cols} этикеток</div>
        <div style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
          <div className="wh-field-label" style={{ marginBottom: 8 }}>Размер этикетки</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {LABEL_SIZES.map((sz) => (
              <label key={sz.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, border: `1px solid ${sizeId === sz.id ? 'var(--color-primary)' : 'var(--color-border)'}`, background: sizeId === sz.id ? 'var(--brand-soft)' : 'transparent' }}>
                <input type="radio" name="labelSize" value={sz.id} checked={sizeId === sz.id} onChange={() => setSizeId(sz.id)} style={{ accentColor: 'var(--color-primary)' }} />
                <span style={{ fontSize: 14, flex: 1 }}>{sz.label}</span>
                {sz.qr && <span style={{ fontSize: 11, color: 'var(--text3)' }}>+ QR</span>}
              </label>
            ))}
          </div>
        </div>
        <button onClick={doPrint} disabled={printing} className="primary" style={{ padding: '10px 32px', marginRight: 8, opacity: printing ? 0.6 : 1 }}>{printing ? 'Готовлю…' : 'Печатать'}</button>
        <button onClick={onClose} style={{ padding: '10px 20px' }}>Отмена</button>
      </div>
    </div>
  );
}

function PrintSheet({ cell, cells, onClose }) {
  const { id } = cell;
  const data = cells[id] || {};
  const today = new Date().toLocaleDateString('ru-RU');

  const doPrint = () => {
    const w = window.open('', '_blank');
    const parts = data.parts || [];
    const rows = Math.max(8, parts.length + 2);
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Лист ячейки ${id}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:10pt;color:#1a1a1a;padding:15mm;background:#fff}
      .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;border-bottom:2px solid #1a1a1a;padding-bottom:10px}
      .title{font-size:18pt;font-weight:700;letter-spacing:1px;text-transform:uppercase}
      .subtitle{font-size:9pt;color:#666;margin-top:3px}
      .badge{background:#1a1a1a;color:#fff;font-size:18pt;font-weight:700;padding:8px 16px;border-radius:4px;font-family:'Courier New',monospace;letter-spacing:2px}
      .meta-row{display:flex;gap:0;margin-bottom:14px}
      .meta-box{border:1px solid #ddd;padding:10px 14px;flex:1}
      .meta-box:first-child{border-right:none}
      .meta-label{font-size:7pt;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px}
      .meta-val{font-size:12pt;font-weight:600}
      .section{margin-bottom:14px}
      .section-title{background:#1a1a1a;color:#fff;padding:5px 10px;font-size:8pt;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:0}
      table{width:100%;border-collapse:collapse;font-size:9pt}
      th{background:#1a1a1a;color:#fff;padding:5px 8px;text-align:left;font-size:8pt}
      td{border:1px solid #ddd;padding:6px 8px;vertical-align:middle}
      tr:nth-child(even) td{background:#fafafa}
      .check{width:20px;height:20px;border:1.5px solid #999;display:inline-block;border-radius:2px}
      .notes-box{border:1px solid #ddd;min-height:55px;padding:8px;font-size:9pt}
      .footer{margin-top:20px;border-top:1px solid #ddd;padding-top:8px;display:flex;justify-content:space-between;font-size:8pt;color:#999}
      @media print{@page{size:A4 portrait;margin:12mm}body{padding:0}}
    </style></head><body>
    <div class="header">
      <div>
        <div class="title">Лист ячейки склада запчастей</div>
        <div class="subtitle">Заказ-наряд № ${data.orderNum || '—'} · ${data.car || '—'} ${data.plate ? '· ' + data.plate : ''}</div>
      </div>
      <div class="badge">${id}</div>
    </div>
    <div class="meta-row">
      <div class="meta-box"><div class="meta-label">Дата открытия</div><div class="meta-val">${data.openedAt || today}</div></div>
      <div class="meta-box"><div class="meta-label">Мастер-приёмщик</div><div class="meta-val">${data.master || '—'}</div></div>
    </div>
    <div class="section">
      <div class="section-title">Перечень запчастей</div>
      <table><thead><tr><th style="width:30px">№</th><th>Наименование запчасти</th><th style="width:130px">Артикул / OEM</th><th style="width:50px">Кол.</th><th style="width:30px">✓</th><th style="width:110px">Дата приёмки</th><th>Состояние / Дефекты &amp; подпись</th></tr></thead>
      <tbody>${Array.from({ length: rows }, (_, i) => { const p = parts[i] || {}; return `<tr><td style="text-align:center;color:#bbb">${i + 1}</td><td>${p.name || ''}</td><td>${p.code || ''}</td><td style="text-align:center">${p.qty || ''}</td><td><span class="check"></span></td><td></td><td></td></tr>`; }).join('')}</tbody></table>
    </div>
    <div class="section">
      <div class="section-title">Примечания / Особые условия хранения</div>
      <div class="notes-box">${data.notes || ''}</div>
    </div>
    <div class="section">
      <div class="section-title">История движения по ячейке</div>
      <table><thead><tr><th style="width:110px">Дата / Время</th><th style="width:170px">Событие</th><th style="width:150px">Сотрудник (ФИО)</th><th style="width:100px">Подпись</th><th>Комментарий</th></tr></thead>
      <tbody>${Array.from({ length: 7 }, () => '<tr><td></td><td></td><td></td><td></td><td></td></tr>').join('')}</tbody></table>
    </div>
    <div class="footer">
      <span>Лист ячейки ${id} · ${data.car || '—'} (${data.plate || '—'}) · ${data.orderNum || '—'}</span>
      <span>Форма СК-01 · rev 1.2</span>
    </div>
    <script>window.print();</script></body></html>`);
    w.document.close();
  };

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик по подложке, и окно схлопывалось само (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div ref={backdropRef} className="wh-modal" style={{ zIndex: 1040 }}>
      <div className="wh-modal-card" style={{ maxWidth: 400, width: '90%', padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--color-primary)', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Icon name="file" size={34} /></div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Лист ячейки {id}</div>
        {data.orderNum ? <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: '1.5rem' }}>{data.car} · {data.orderNum}</div>
          : <div style={{ color: 'var(--text3)', fontSize: 13, marginBottom: '1.5rem' }}>Ячейка свободна — пустой лист</div>}
        <button onClick={doPrint} className="primary" style={{ padding: '10px 32px', marginRight: 8 }}>Печатать</button>
        <button onClick={onClose} style={{ padding: '10px 20px' }}>Отмена</button>
      </div>
    </div>
  );
}
