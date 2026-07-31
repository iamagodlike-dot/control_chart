import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildIntakeBoard, fmtDayTime, intakeRow } from '../intake';
import IntakeView from './IntakeView';
import IntakeCarModal from './IntakeCarModal';
import InspectionWizard from './InspectionWizard';

// Контейнер экрана мастера-приёмщика: живая подписка на машины фазы
// «согласование» (её же слушает доска «Согласование»), состояние поиска и попапа,
// запись на дефектовку. Вся логика раскладки — в intake.js, вся вёрстка — в
// IntakeView и IntakeCarModal.
//
// Отдельной подписки «только машины на осмотре» нет сознательно: subscribeApproval
// уже приходит целиком, а лишний onSnapshot — это второй поток чтений Firestore
// при бесплатной квоте. Отбор по под-статусу делает buildIntakeBoard.

export default function Intake({ profile = null }) {
  // Имя приёмщика печатается в акте в строке «ТС принял». Если управленец завёл
  // логин без имени — подставляем почту: прочерк в подписанном клиентом акте
  // хуже, чем невзрачное «priem@…».
  const userName = profile?.name || profile?.email || '';

  const [jobs, setJobs] = useState(null);        // null → ещё грузим
  const [company, setCompany] = useState({});
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);    // попап машины (звонок, перенос)
  const [inspectId, setInspectId] = useState(null); // мастер дефектовки
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const unsub = api.jobs.subscribeApproval(setJobs, () => setJobs([]));
    return () => unsub();
  }, []);

  // Реквизиты нужны только печатному акту — читаем разово, сбой не должен ронять
  // экран: без реквизитов акт напечатается, просто с пустой шапкой.
  useEffect(() => {
    api.settings.getCompany().then(setCompany).catch(() => {});
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

  const inspectJob = useMemo(
    () => (inspectId ? (jobs || []).find((j) => j.id === inspectId) || null : null),
    [jobs, inspectId],
  );

  function open(id) {
    setError('');
    setOpenId(id);
  }

  function close() {
    setError('');
    setOpenId(null);
  }

  // Прежнюю дату передаём в api сами: слой данных её больше не дочитывает, чтобы
  // запись переживала работу без связи (см. комментарий к setIntakeDate).
  const schedule = useCallback(async ({ at, reason, agreed }) => {
    if (!openId) return;
    setBusy(true);
    setError('');
    try {
      const prevAt = openRow?.scheduled_at || 0;
      await api.jobs.setIntakeDate(openId, { at, reason, agreed, prevAt });
      setNote(`${prevAt ? 'Перенесли' : 'Записали'} на ${fmtDayTime(at)}`);
      setOpenId(null);
    } catch (e) {
      setError(e?.message || 'Не удалось сохранить — нет связи');
    } finally {
      setBusy(false);
    }
  }, [openId, openRow]);

  const confirmVisit = useCallback(async (id) => {
    const job = (jobs || []).find((j) => j.id === id);
    const at = Number(job?.intake?.scheduled_at) || 0;
    setBusy(true);
    setError('');
    try {
      await api.jobs.confirmIntakeVisit(id, { at });
      setNote('Отметили: клиент подтвердил приезд');
    } catch (e) {
      setError(e?.message || 'Не удалось сохранить — нет связи');
    } finally {
      setBusy(false);
    }
  }, [jobs]);

  // Осмотр приехавшей машины. Отметку «начали» ставим один раз — по ней машина
  // перестаёт считаться неприехавшей и уходит из напоминаний. Повторный вход в
  // уже начатый осмотр её не переписывает.
  const startInspection = useCallback(async (id) => {
    const job = (jobs || []).find((j) => j.id === id);
    setError('');
    setOpenId(null);
    setInspectId(id);
    if (job && !job.intake?.started_at) {
      try { await api.jobs.startInspection(id); } catch { /* офлайн — запись догонит */ }
    }
  }, [jobs]);

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

      {/* Мастер дефектовки берёт машину из живого списка: пока приёмщик снимает
          круг, управленец мог дописать примечание. key — чтобы при переходе к
          другой машине шаги начинались сначала. */}
      {inspectJob && (
        <InspectionWizard
          key={inspectJob.id}
          job={inspectJob}
          company={company}
          userName={userName}
          onClose={() => setInspectId(null)}
          onAdvanced={() => { setInspectId(null); setNote('Машина ушла в «Калькуляцию»'); }}
        />
      )}

      {note && <div className="ink-toast">{note}</div>}
    </>
  );
}
