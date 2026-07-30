import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildIntakeList } from '../intake';
import IntakeView from './IntakeView';
import IntakeCard from './IntakeCard';
import DocumentsModal from './DocumentsModal';

// Контейнер экрана «Приёмка авто»: живая подписка на машины фазы «согласование»
// (её же слушает доска «Согласование»), настройки приёмки, состояние фильтров и
// открытие карточки одной машины. Вся логика готовности — в intake.js, вся
// вёрстка списка — в IntakeView.
//
// Отдельной подписки «только машины на осмотре» нет сознательно: subscribeApproval
// уже приходит целиком, а лишний onSnapshot — это второй поток чтений Firestore
// при бесплатной квоте. Отбор по под-статусу делает buildIntakeList.
export default function Intake({ profile = null }) {
  const [jobs, setJobs] = useState(null);        // null → ещё грузим
  const [settings, setSettings] = useState(null);
  const [company, setCompany] = useState({});
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('urgent');
  const [openId, setOpenId] = useState(null);
  const [docsJob, setDocsJob] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const unsub = api.jobs.subscribeApproval(setJobs, () => setJobs([]));
    return () => unsub();
  }, []);

  // Настройки и реквизиты читаем разово: они меняются раз в месяц, а живая
  // подписка на них стоила бы столько же, сколько подписка на машины.
  // Сбой чтения не должен ронять экран — тогда работаем на дефолтах intake.js.
  useEffect(() => {
    api.settings.getIntake().then(setSettings).catch(() => setSettings({}));
    api.settings.getCompany().then(setCompany).catch(() => {});
  }, []);

  // Счётчик «сколько дней машина стоит» должен оставаться живым у экрана,
  // открытого весь день. Date.now() в рендере запрещён правилом чистоты проекта.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const vm = useMemo(
    () => buildIntakeList(jobs || [], settings, { query, sort, nowMs }),
    [jobs, settings, query, sort, nowMs],
  );

  // Открытая машина берётся из ЖИВОГО списка: пока приёмщик заполняет карточку,
  // запчастист мог дописать позиции — карточка не должна показывать слепок.
  const openJob = useMemo(
    () => (openId ? (jobs || []).find((j) => j.id === openId) || null : null),
    [jobs, openId],
  );

  return (
    <>
      <IntakeView
        loading={jobs === null || settings === null}
        rows={vm.rows}
        counts={vm.counts}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        onOpen={setOpenId}
      />

      {/* key={openId} — карточка каждой машины стартует с чистым состоянием */}
      {openJob && (
        <IntakeCard
          key={openId}
          job={openJob}
          settings={vm.settings}
          company={company}
          userName={profile?.name || ''}
          onClose={() => setOpenId(null)}
          onOpenDocs={async (job) => setDocsJob(await api.jobs.get(job.id))}
          onAdvanced={() => setOpenId(null)}
        />
      )}

      {docsJob && (
        <DocumentsModal job={docsJob} company={company} onClose={() => setDocsJob(null)} />
      )}
    </>
  );
}
