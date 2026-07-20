// Pure helpers for the «Наряд мастера» printable sheet. No React, no Firestore —
// same style as orderDoc.js / costing.js.

function pad2(x) {
  return String(x).padStart(2, '0');
}

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Snapshot for one master's наряд, from the job + company + a computed labor
// row (computeCosting().labor_rows item) + the costing's works list.
export function buildWorksheet(job = {}, company = {}, laborRow = {}, services = []) {
  const works = (services || [])
    .filter((s) => laborRow.master_id && s.master_id === laborRow.master_id)
    .map((s) => ({ id: s.id, name: s.name || '', qty: Number(s.qty) || 0, price: Number(s.price) || 0 }));
  return {
    doc_number: job.order_number || '',
    doc_date: todayInput(),
    company: {
      name: company.name || '',
      inn: company.inn || '',
      ogrn: company.ogrn || '',
      address: company.address || '',
      phone: company.phone || '',
      director: company.director || '',
    },
    master: { name: laborRow.name || '' },
    vehicle: {
      car_model: job.car_model || '',
      plate_number: job.plate_number || '',
      vin: job.vin || '',
    },
    works,
    works_sum: Number(laborRow.works_sum) || 0,
    // total — финальная сумма к выплате мастеру (введённая в «Себестоимости»);
    // сдельный % — только внутренняя подсказка, на наряде не печатается.
    total: Number(laborRow.total) || 0,
  };
}
