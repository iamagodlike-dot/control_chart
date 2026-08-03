import { useMemo, useState } from 'react';
import Icon from './Icon';
import DateTimeField from './DateTimeField';
import { PAYMENT_SHORT } from '../insurance';
import { useModalEscape } from '../modalEscape';
import {
  describeLogEntry, fmtDayTime, fmtRelativeDay, parseLocalDateTime, pluralDays,
  toLocalInput, validateSchedule,
} from '../intake';

// Попап одной машины на экране приёмщика. ОДНО окно на два действия:
// пригласить впервые и перенести уже назначенную дефектовку. Различает их не
// вызывающий, а сами данные (`row.scheduled_at`), — поэтому «перенос» физически
// не может уехать без чекбокса и причины, из какого бы места экрана его ни открыли.
//
// Сверху — всё, что нужно сказать в трубку: телефон, клиент, страховая, номер
// убытка, примечания управленца. Приёмщик звонит, глядя в это окно, и тут же
// вписывает согласованное время, не закрывая его.

export default function IntakeCarModal({
  row,
  nowMs = 0,
  busy = false,
  error = '',
  onClose = () => {},
  onSchedule = () => {},
  onConfirm = () => {},
  onStart = () => {},
}) {
  const isMove = !!row.scheduled_at;

  // При переносе поле заполнено текущей датой: обычно правят время, а не набирают
  // всё заново. При первом приглашении — пусто, чтобы случайно не сохранить
  // подставленную дату вместо той, что реально назвал клиент. У просроченной
  // машины подставлять нечего: её дата уже в прошлом, и форма сразу ругалась бы
  // на собственную подсказку.
  const [dt, setDt] = useState(
    () => (isMove && row.phase !== 'overdue' ? toLocalInput(row.scheduled_at) : ''),
  );
  const [agreed, setAgreed] = useState(false);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const at = useMemo(() => parseLocalDateTime(dt), [dt]);
  const check = useMemo(
    () => validateSchedule({ at, reason, agreed, isMove, nowMs }),
    [at, reason, agreed, isMove, nowMs],
  );
  const errors = submitted ? check.errors : {};

  function submit(e) {
    e.preventDefault();
    setSubmitted(true);
    if (!check.ok || busy) return;
    onSchedule({ at, reason: reason.trim(), agreed });
  }

  const insured = row.payment_type === 'insurance';
  const phoneHref = `tel:${String(row.client_phone || '').replace(/[^\d+]/g, '')}`;

  // Клик мимо окна не закрывает: приёмщик заполняет его, разговаривая по телефону,
  // и случайное касание рядом не должно стирать согласованную дату (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div className="modal-backdrop ink-backdrop" ref={backdropRef}>
      <div className="ink-modal">
        <header className="ink-modal-head">
          <div className="ink-modal-id">
            {row.plate_number && <span className="ink-plate">{row.plate_number}</span>}
            <span className="ink-model">{row.car_model}</span>
          </div>
          <button type="button" className="ink-x" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="ink-modal-body">
          {/* ── Что сказать в трубку ─────────────────────────────────────── */}
          <div className="ink-call">
            {row.client_phone ? (
              <a className="ink-call-phone" href={phoneHref}>
                <Icon name="phone" size={18} />{row.client_phone}
              </a>
            ) : (
              <div className="ink-call-phone is-empty">
                <Icon name="phone" size={18} />Телефон не указан
              </div>
            )}
            <div className="ink-call-who">
              {row.client_name || 'Клиент не указан'}
              <span className={`ink-payer${insured ? ' is-insured' : ''}`}>
                <Icon name={insured ? 'shield' : 'wallet'} size={13} />
                {insured ? (row.insurer_name || 'Страховая') : (PAYMENT_SHORT[row.payment_type] || 'Клиент')}
              </span>
            </div>
          </div>

          <dl className="ink-facts">
            {insured && row.claim_number && (<><dt>№ убытка</dt><dd>{row.claim_number}</dd></>)}
            {insured && row.policy_number && (<><dt>№ полиса</dt><dd>{row.policy_number}</dd></>)}
            {row.order_number && (<><dt>Заказ-наряд</dt><dd>{row.order_number}</dd></>)}
            {row.vin && (<><dt>VIN</dt><dd className="ink-vin">{row.vin}</dd></>)}
            <dt>Ждёт</dt>
            <dd>
              {row.daysWaiting === 0
                ? 'заехала сегодня'
                : `${row.daysWaiting} ${pluralDays(row.daysWaiting)} на осмотре`}
            </dd>
          </dl>

          {row.notes && <div className="ink-note"><span>Примечание</span>{row.notes}</div>}

          {/* ── Текущая запись ───────────────────────────────────────────── */}
          {isMove && (
            <div className={`ink-current is-${row.phase}`}>
              <div className="ink-current-when">
                <Icon name="calendar" size={15} />
                Записана на <b>{fmtDayTime(row.scheduled_at)}</b>
                <span className="ink-muted">{fmtRelativeDay(row.scheduled_at, nowMs)}</span>
              </div>
              {row.phase === 'overdue' && (
                <div className="ink-current-warn"><Icon name="warning" size={14} />День прошёл, машины не было</div>
              )}
              {row.confirmed && (
                <div className="ink-ok"><Icon name="check" size={13} strokeWidth={2.6} />клиент подтвердил приезд</div>
              )}
              {/* Подтверждать имеет смысл только то, что ещё не наступило: у
                  просроченной машины остаётся один путь — перенести. */}
              {!row.confirmed && row.phase === 'scheduled' && (
                <button type="button" className="ink-btn is-quiet" onClick={() => onConfirm(row.id)} disabled={busy}>
                  <Icon name="check" size={14} strokeWidth={2.4} />Клиент подтвердил
                </button>
              )}
            </div>
          )}

          {/* ── Форма ────────────────────────────────────────────────────── */}
          <form className="ink-form" onSubmit={submit}>
            <label className="ink-field">
              <span>{isMove ? 'Новые дата и время' : 'Согласованные дата и время'}</span>
              <DateTimeField value={dt} onChange={setDt} mode="datetime" placeholder="Выберите дату и время" />
              {errors.at && <em className="ink-err">{errors.at}</em>}
            </label>

            {isMove && (
              <>
                <label className={`ink-agree${errors.agreed ? ' is-err' : ''}`}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>Дата и время согласованы с клиентом</span>
                </label>
                {errors.agreed && <em className="ink-err">{errors.agreed}</em>}

                <label className="ink-field">
                  <span>Причина переноса</span>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Например: клиент в отъезде до пятницы"
                  />
                  {errors.reason && <em className="ink-err">{errors.reason}</em>}
                </label>
              </>
            )}

            {error && <div className="ink-banner is-error"><Icon name="warning" size={15} />{error}</div>}

            <button type="submit" className="ink-btn is-primary is-big" disabled={busy}>
              {isMove ? 'Сохранить перенос' : 'Записать на дефектовку'}
            </button>
          </form>

          {/* ── Журнал ───────────────────────────────────────────────────── */}
          {row.log.length > 0 && (
            <div className="ink-log">
              <div className="ink-log-head">История записи</div>
              <ul>
                {row.log.map((e, i) => (
                  <li key={`${e.at}-${i}`} className={`is-${e.kind}`}>
                    <span className="ink-log-when">{fmtDayTime(e.at)}</span>
                    <span className="ink-log-what">
                      {describeLogEntry(e)}
                      {e.reason && <em>{e.reason}</em>}
                    </span>
                    {e.by && <span className="ink-log-by">{e.by}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="ink-modal-foot">
          <button type="button" className="ink-btn" onClick={() => onStart(row.id)} disabled={busy}>
            Начать дефектовку →
          </button>
        </footer>
      </div>
    </div>
  );
}
