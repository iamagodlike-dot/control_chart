import { useMemo, useState } from 'react';
import { auth } from '../firebase';
import { buildDraft, mailTemplate, mailPhotoOptions, fmtSize } from '../mail';
import { buildPhotoArchive, downloadBlob, archiveName } from '../photoZip';
import { api } from '../api';
import Icon from './Icon';
import { useModalEscape } from '../modalEscape';

// Окно «Фото и письмо» по машине: готовый текст письма оценщику + выбор фото,
// которые уедут ему архивом.
//
// ПОЧЕМУ ЗДЕСЬ НЕТ КНОПКИ «ОТПРАВИТЬ»: хостинг режет исходящий SMTP (порты
// 25/465/587/2525 закрыты — проверено с сервера), поэтому письмо отправляют руками
// из Яндекс.Почты. Система делает всё остальное: готовит текст (его забирают
// кнопкой «Копировать текст»), складывает выбранные снимки в архив и пишет факт
// выгрузки в журнал машины. В архиве ТОЛЬКО ФОТО — файл с текстом внутрь не кладём
// (решение владельца). Отправку допишем, когда откроют порт: buildDraft уже готов.
//
// Архив собирается В БРАУЗЕРЕ (см. photoZip.js): фото качаются с nginx напрямую,
// сервер приложения в этом не участвует.

// Средний вес нашего сжатого снимка. Нужен только для строки «≈ 3.4 МБ»: у части
// старых фото размер в базе не записан, и без оценки счётчик врал бы вниз.
const AVG_PHOTO_BYTES = 350_000;

export default function MailModal({ job, company = {}, template = 'calc', onClose, onLogged }) {
  const tpl = mailTemplate(template);
  const photoOptions = useMemo(() => mailPhotoOptions(job), [job]);

  // Тема и текст: null = «человек ещё не правил», тогда показываем заготовку.
  // Так строка «Во вложении фото: 12» пересчитывается под галочками, а как только
  // текст тронули руками — заготовка больше в него не лезет и не стирает правки.
  const [subjectEdit, setSubjectEdit] = useState(null);
  const [textEdit, setTextEdit] = useState(null);
  const [picked, setPicked] = useState(() => new Set(photoOptions.filter((p) => p.checked).map((p) => p.id)));
  const [zipping, setZipping] = useState(null);       // прогресс сборки: { done, total }
  const [zipped, setZipped] = useState(null);         // что скачалось
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const chosenPhotos = useMemo(() => photoOptions.filter((p) => picked.has(p.id)), [photoOptions, picked]);
  const bytes = useMemo(() => chosenPhotos.reduce((n, p) => n + (p.size || AVG_PHOTO_BYTES), 0), [chosenPhotos]);
  const approxSize = chosenPhotos.some((p) => !p.size);

  const senderName = company.director || auth.currentUser?.displayName || '';

  // Заготовка письма. Считается при отрисовке (не в эффекте) — тогда смена галочек
  // сразу видна в тексте, а лишних перерисовок нет.
  const draft = useMemo(
    () => buildDraft(template, job, { company, senderName, photoCount: chosenPhotos.length }),
    [template, job, company, senderName, chosenPhotos.length],
  );
  const subject = subjectEdit ?? draft.subject;
  const text = textEdit ?? draft.text;

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const setAll = (list) => setPicked(new Set(list.map((p) => p.id)));

  // Собрать и отдать архив. Фото качаются по одному, поэтому показываем счётчик:
  // на 40 снимках это несколько секунд.
  async function downloadArchive() {
    setError('');
    setZipped(null);
    setZipping({ done: 0, total: chosenPhotos.length });
    try {
      const { blob, missing } = await buildPhotoArchive(chosenPhotos, {
        onProgress: (done, total) => setZipping({ done, total }),
      });
      downloadBlob(blob, `${archiveName(job)}.zip`);
      const count = chosenPhotos.length - missing.length;
      setZipped({ count, bytes: blob.size, missing });
      // Факт выгрузки — в журнал машины: видно, что просчёт уже готовили, и второй
      // раз оценщика не дёрнут. Архив уже у человека, поэтому сбой записи не
      // считаем ошибкой отправки — только пишем в консоль.
      try {
        const entry = await api.jobs.logExport(job.id, { template, photos: count, bytes: blob.size });
        if (onLogged) onLogged(entry);
      } catch (e) {
        console.warn('Архив скачан, но запись в журнал не удалась:', e);
      }
    } catch (e) {
      setError(`Не удалось собрать архив: ${e.message || 'неизвестная ошибка'}`);
    } finally {
      setZipping(null);
    }
  }

  // Текст в буфер обмена — чтобы вставить его в письмо, не открывая архив.
  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Браузер не дал скопировать текст — выделите его в поле и скопируйте вручную');
    }
  }

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик, и наполовину заполненная форма пропадала (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div className="modal-backdrop" ref={backdropRef}>
      <div className="modal modal-wide mm-modal">
        <div className="cc-header">
          <div className="cc-header-main">
            <div className="cc-header-text">
              <div className="cc-doc-label">{tpl.label}</div>
              <h3 className="cc-title">Фото и письмо</h3>
              <div className="cc-header-meta">
                <span className="cc-header-sub">
                  {job.car_model || 'Без модели'}{job.plate_number ? ` · ${job.plate_number}` : ''}
                  {job.claim_number ? ` · убыток № ${job.claim_number}` : ''}
                </span>
              </div>
            </div>
          </div>
          <button className="cc-close" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={18} strokeWidth={2} /></button>
        </div>

        <div className="cc-body">
          <div className="mm-note">
            <Icon name="mail" size={14} />
            <div>
              Скачайте архив с выбранными фото и отправьте письмо из Яндекс.Почты:
              архив — вложением, текст — кнопкой «Копировать текст».
            </div>
          </div>

          <div className="mm-fields">
            <label className="cc-field full">
              <span>Тема письма</span>
              <input value={subject} onChange={(e) => setSubjectEdit(e.target.value)} />
            </label>
            <label className="cc-field full">
              <span>Текст письма <i>— правьте как обычный текст</i></span>
              <textarea
                className="mm-text"
                rows={16}
                value={text}
                onChange={(e) => setTextEdit(e.target.value)}
              />
            </label>
          </div>

          <section className="cc-section" style={{ marginTop: 12 }}>
            <div className="cc-section-head">
              <span className="cc-section-icon" />Фото в архиве
              <span className="cc-section-hint">
                {chosenPhotos.length} из {photoOptions.length}
                {bytes ? ` · ${approxSize ? '≈ ' : ''}${fmtSize(bytes)}` : ''}
              </span>
            </div>
            {photoOptions.length === 0 ? (
              <div className="cc-hint" style={{ marginTop: 0 }}>
                У машины ещё нет фотографий на сервере. Снимки добавляются в дефектовке
                или на вкладке «Фото» — без них оценщик ничего не посчитает.
              </div>
            ) : (
              <>
                <div className="mm-photo-actions">
                  <button className="small" onClick={() => setAll(photoOptions)}>Отметить все</button>
                  <button className="small" onClick={() => setPicked(new Set())}>Снять все</button>
                  <button className="small" onClick={() => setAll(photoOptions.filter((p) => p.group === 'damage'))}>
                    Только повреждения
                  </button>
                </div>
                <div className="mm-photos">
                  {photoOptions.map((p) => {
                    const on = picked.has(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className={`mm-photo${on ? ' is-on' : ''}`}
                        onClick={() => toggle(p.id)}
                        title={p.label}
                      >
                        <img src={p.url} alt={p.label} loading="lazy" />
                        <span className="mm-photo-check">{on ? <Icon name="check" size={12} strokeWidth={2.5} /> : null}</span>
                        <span className="mm-photo-label">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* Архив собран — говорим что именно скачалось (файл уже у человека). */}
          {zipped && (
            <div className="mm-ok">
              <Icon name="check" size={14} strokeWidth={2.2} />
              <span>
                Архив скачан: {zipped.count} фото · {fmtSize(zipped.bytes)}.
                {zipped.missing.length > 0 && ` Не нашлось на сервере: ${zipped.missing.length}.`}
              </span>
            </div>
          )}

          {error && <div className="mm-error"><Icon name="warning" size={14} />{error}</div>}
        </div>

        <div className="cc-footer">
          <button onClick={onClose}>Закрыть</button>
          <div className="cc-footer-actions">
            <button className="cc-btn-ico" onClick={copyText} disabled={!!zipping}>
              <Icon name="clipboard" size={14} />{copied ? 'Скопировано ✓' : 'Копировать текст'}
            </button>
            <button
              className="primary"
              disabled={!!zipping}
              onClick={downloadArchive}
              title="Zip с выбранными фото — вложить в письмо в Яндекс.Почте"
            >
              <Icon name="download" size={14} />
              {zipping ? `Собираем… ${zipping.done}/${zipping.total}` : 'Скачать архив'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
