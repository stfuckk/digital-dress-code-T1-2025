import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// URL для загрузки модели FP16
const MODEL_URL =
  "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp16.onnx";

// Пути для сохранения
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MODELS_DIR = path.join(PUBLIC_DIR, "models");

// Создаем директории если их нет
[PUBLIC_DIR, MODELS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Функция для загрузки с помощью curl/wget
async function downloadWithCurl(url, dest) {
  console.log("📥 Загрузка модели с помощью curl/wget...");

  try {
    // Пробуем curl с опцией -L для следования редиректам
    await execAsync(`curl -L -o "${dest}" "${url}"`);
    return true;
  } catch (curlError) {
    console.log("curl не доступен, пробуем wget...");

    try {
      // Пробуем wget
      await execAsync(`wget -O "${dest}" "${url}"`);
      return true;
    } catch (wgetError) {
      console.log("❌ wget также не доступен");
      return false;
    }
  }
}

async function main() {
  console.log("🤖 Загрузка модели RVM ResNet50 FP16...");
  console.log("📦 Размер: ~51MB");

  const modelPath = path.join(MODELS_DIR, "rvm_resnet50_fp16.onnx");

  // Проверяем существующий файл
  if (fs.existsSync(modelPath)) {
    const stats = fs.statSync(modelPath);
    if (stats.size > 50 * 1024 * 1024) {
      // Проверяем, что файл больше 50MB
      console.log("✅ Модель уже существует!");
      console.log(`📊 Размер: ${Math.round(stats.size / 1024 / 1024)}MB`);
      return;
    } else {
      console.log("⚠️ Найден файл модели неверного размера. Перезагружаем...");
      fs.unlinkSync(modelPath);
    }
  }

  try {
    const success = await downloadWithCurl(MODEL_URL, modelPath);

    if (!success) {
      throw new Error("Не удалось загрузить через curl/wget");
    }

    // Проверяем размер загруженного файла
    const stats = fs.statSync(modelPath);
    if (stats.size < 50 * 1024 * 1024) {
      throw new Error(
        `Загруженный файл слишком мал (${Math.round(stats.size / 1024 / 1024)}MB)`,
      );
    }

    console.log(`✅ Модель успешно загружена!`);
    console.log(`📊 Размер: ${Math.round(stats.size / 1024 / 1024)}MB`);
    console.log(`📁 Путь: ${modelPath}`);
  } catch (err) {
    console.error("❌ Ошибка:", err.message);

    console.log("\n📋 Альтернативный способ:");
    console.log("1. Скачайте модель вручную по ссылке:");
    console.log(`   ${MODEL_URL}`);
    console.log("\n2. Поместите файл в папку:");
    console.log(`   ${MODELS_DIR}/`);
    console.log("\n3. Убедитесь, что файл называется:");
    console.log("   rvm_resnet50_fp16.onnx");
  }
}

main().catch(console.error);
