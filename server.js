const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /doc|docx|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Только файлы формата DOC, DOCX и PDF разрешены'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Маршрут для главной страницы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Маршрут для загрузки файла
app.post('/upload', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  try {
    // Чтение содержимого файла в зависимости от типа
    let textContent = '';
    
    if (req.file.mimetype === 'application/pdf') {
      const dataBuffer = await fs.readFile(req.file.path);
      const data = await pdfParse(dataBuffer);
      textContent = data.text;
    } else if (req.file.mimetype.includes('word')) {
      const result = await mammoth.extractRawText({ path: req.file.path });
      textContent = result.value;
    } else {
      // Для других случаев (хотя фильтр уже пропускает только нужные типы)
      textContent = await fs.readFile(req.file.path, 'utf8');
    }

    res.json({
      success: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      content: textContent
    });
  } catch (error) {
    console.error('Ошибка при чтении файла:', error);
    res.status(500).json({ error: 'Ошибка при чтении файла' });
  }
});

// Маршрут для проверки документа ИИ
app.post('/check-document', async (req, res) => {
  try {
    const { filename, content } = req.body;
    
    // Загружаем промпт из файла
    const prompt = await fs.readFile('./prompt.txt', 'utf8');
    
    // Вызываем ИИ для проверки документа
    const result = await checkDocumentWithAI(content, prompt);
    
    res.json({
      success: true,
      result: result
    });
  } catch (error) {
    console.error('Ошибка при проверке документа:', error);
    res.status(500).json({ error: 'Ошибка при проверке документа' });
  }
});

// Функция для проверки документа с помощью ИИ
async function checkDocumentWithAI(documentContent, prompt) {
  // Загружаем конфигурацию API ИИ
  const aiConfig = JSON.parse(await fs.readFile('./ai-config.json', 'utf8'));
  
  // Подключаемся к выбранному API ИИ
  if (aiConfig.provider === 'openai') {
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: aiConfig.apiKey
    });

    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: documentContent }
      ],
      model: aiConfig.model || 'gpt-3.5-turbo',
    });

    return completion.choices[0].message.content;
  } else if (aiConfig.provider === 'gemini') {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(aiConfig.apiKey);
    const model = genAI.getGenerativeModel({ model: aiConfig.model || "gemini-pro" });

    const result = await model.generateContent(prompt + "\n\n" + documentContent);
    const response = await result.response;
    return response.text();
  } else {
    throw new Error('Неподдерживаемый провайдер ИИ');
  }
}

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});