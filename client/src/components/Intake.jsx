import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildIntakeBoard, fmtDayTime, intakeRow } from '../intake';
import IntakeView from './IntakeView';
import IntakeCarModal from './IntakeCarModal';

// Контейнер экрана мастера-приёмщика: живая подписка на машины фазы
// «согласование» (её же слушает доска «Согласование»), состояние поиска и попапа,
// запись на дефектовку. Вся логика раскладки — в intake.js, вся вёрстка — в
// IntakeView и IntakeCarModal.
//
// Отдельной подписки «только машины на осмотре» нет сознательно: subscribeApproval
// уже приходит целиком, а лишний onSnapshot — это второй поток чтений Firestore
// при бесплатной квоте. Отбор по под-статусу делает buildIntakeBoard.

export default function Intake() {
  const [jobs, setJobs] = useState(null);        // null → ещё грузим
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const unsub = api.jobs.subscribeApproval(setJobs, () => setJobs([]));
    return () => unsub();
  }, []);

  // Часы экрана. «Сколько дней ждёт», «завтра», подсветка сегодняшней клетки и
  // сами напоминания зависят от текущего момента, а экран у приёмщика открыт весь
  // день. Date.now() в рендере запрещён правилом чистоты проекта.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Короткое сообщение об успехе гаснет само: подтверждать его кнопкой — лишнее
  // касание у человека, который стоит с телефоном в одной руке.
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(''), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const board = useMemo(
    () => buildIntakeBoard(jobs || [], { nowMs, query }),
    [jobs, nowMs, query],
  );

  // Открытая машина считается от ЖИВОГО списка, а не запоминается при клике: пока
  // приёмщик звонит, управленец мог дописать примечание или поменять страховую.
  // Ищем по всем машинам, а не по отфильтрованным поиском, — иначе набранный
  // текст закрыл бы уже открытый попап.
  const openRow = useMemo(() => {
    const job = openId ? (jobs || []).find((j) => j.id === openId) : null;
    return job ? intakeRow(job, nowMs) : null;
  }, [jobs, openId, nowMs]);

  function open(id) {
    setError('');
    setOpenId(id);
  }

  function close() {
    setError('');
    setOpenId(null);
  }

  const schedule = useCallback(async ({ at, reason, agreed }) => {
    if (!openId) return;
    setBusy(true);
    setError('');
    try {
      const moved = !!openRow?.scheduled_at;
      await api.jobs.setIntakeDate(openId, { at, reason, agreed });
      setNote(`${moved ? 'Перенесли' : 'Записали'} на ${fmtDayTime(at)}`);
      setOpenId(null);
    } catch (e) {
      setError(e?.message || 'Не удалось сохранить — нет связи');
    } finally {
      setBusy(false);
    }
  }, [openId, openRow]);

  const confirmVisit = useCallback(async (id) => {
    setBusy(true);
    setError('');
    try {
      await api.jobs.confirmIntakeVisit(id);
      setNote('Отметили: клиент подтвердил приезд');
    } catch (e) {
      setError(e?.message || 'Не удалось сохранить — нет связи');
    } finally {
      setBusy(false);
    }
  }, []);

  // Следующий шаг проекта: сам осмотр (чек-лист, фото, повреждения). Пока кнопка
  // честно говорит, что экрана ещё нет, — молчащая кнопка выглядела бы поломкой.
  const startInspection = useCallback(() => {
    setNote('Экран дефектовки пока не сделан — это следующий шаг');
  }, []);

  return (
    <>
      <IntakeView
        loading={jobs === null}
        board={board}
        query={query}
        onQuery={setQuery}
        nowMs={nowMs}
        onOpen={open}
        onConfirm={confirmVisit}
        onStart={startInspection}
      />

      {openRow && (
        <IntakeCarModal
          key={openRow.id}
          row={openRow}
          nowMs={nowMs}
          busy={busy}
          error={error}
          onClose={close}
          onSchedule={schedule}
          onConfirm={confirmVisit}
          onStart={startInspection}
        />
      )}

      {note && <div className="ink-toast">{note}</div>}
    </>
  );
}
