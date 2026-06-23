import Anthropic from '@anthropic-ai/sdk';

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    car_model: { type: 'string' },
    plate_number: { type: 'string' },
    vin: { type: 'string' },
    client_name: { type: 'string' },
    services: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          price: { type: 'number' },
        },
        required: ['name', 'qty', 'price'],
        additionalProperties: false,
      },
    },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string' },
          price: { type: 'number' },
        },
        required: ['name', 'qty', 'price'],
        additionalProperties: false,
      },
    },
  },
  required: ['services', 'parts'],
  additionalProperties: false,
};

const PROMPT = `Это смета калькуляции из Audatex (или аналогичной программы расчёта стоимости ремонта). Извлеки из документа:
- марку и модель автомобиля, гос. номер, VIN, имя клиента — если присутствуют;
- список работ: наименование, количество, цена за единицу в рублях;
- список запчастей/материалов: код/артикул (если есть), наименование, количество, единица измерения, цена за единицу в рублях.
Цены указывай числом без пробелов и валюты. Если поле не найдено в документе — не включай его в ответ.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
    return;
  }

  const { pdfBase64 } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    res.status(400).json({ error: 'pdfBase64 is required' });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const data = textBlock ? JSON.parse(textBlock.text) : { services: [], parts: [] };
    res.status(200).json(data);
  } catch (err) {
    console.error('extract-audatex failed', err);
    res.status(502).json({ error: 'Не удалось распознать документ' });
  }
}
