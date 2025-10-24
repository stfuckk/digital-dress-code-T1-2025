import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// URLs для загрузки
const MODEL_URL =
  "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx";

// Пути для сохранения
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MODELS_DIR = path.join(PUBLIC_DIR, "models");

// Создаем директории если их нет
[PUBLIC_DIR, MODELS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Функция для загрузки файла
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Обработка редиректа
          https
            .get(response.headers.location, (redirectResponse) => {
              redirectResponse.pipe(file);
              file.on("finish", () => {
                file.close();
                resolve();
              });
            })
            .on("error", reject);
        } else {
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        }
      })
      .on("error", reject);
  });
}

async function main() {
  console.log("Загрузка RVM модели...");

  // Загружаем модель
  const modelPath = path.join(MODELS_DIR, "rvm_mobilenetv3_fp32.onnx");
  if (!fs.existsSync(modelPath)) {
    try {
      await downloadFile(MODEL_URL, modelPath);
      console.log("Модель загружена успешно!");
    } catch (err) {
      console.error("❌ Ошибка загрузки модели:", err);
    }
  } else {
    console.log("Модель уже существует");
  }
  console.log("\nГотово! Теперь запустите npm install && npm run dev");
}

main().catch(console.error);
