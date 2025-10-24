<template>
    <div class="full-interface mono">
        <header class="header mono-surface">
            <h1>Цифровой дресс-код</h1>
            <div class="header-year">@2025</div>
        </header>

        <div class="content">
            <aside class="controls-panel">
                <div class="control-group">
                    <h3>Информация о пользователе</h3>

                    <div class="form-grid">
                        <div class="col-span-2">
                            <label class="label">Полное имя</label>
                            <input v-model="fullNameC" class="input-field" />
                        </div>
                        <div>
                            <label class="label">Должность</label>
                            <input v-model="positionC" class="input-field" />
                        </div>
                        <div>
                            <label class="label">Компания</label>
                            <input v-model="companyC" class="input-field" />
                        </div>
                        <div class="col-span-2">
                            <label class="label">Подразделение</label>
                            <input v-model="departmentC" class="input-field" />
                        </div>
                        <div class="col-span-2">
                            <label class="label">Локация офиса</label>
                            <input v-model="officeC" class="input-field" />
                        </div>
                        <div>
                            <label class="label">Email</label>
                            <input
                                v-model="employee.contact.email"
                                class="input-field"
                                type="email"
                            />
                        </div>
                        <div>
                            <label class="label">Telegram</label>
                            <input
                                v-model="employee.contact.telegram"
                                class="input-field"
                            />
                        </div>
                        <div class="col-span-2">
                            <label class="label">Слоган</label>
                            <input v-model="sloganC" class="input-field" />
                        </div>
                        <div>
                            <label class="label">Уровень приватности</label>
                            <select
                                v-model="privacyLevel"
                                class="select-field privacy-select"
                            >
                                <option value="low">Низкий</option>
                                <option value="medium">Средний</option>
                                <option value="high">Высокий</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="control-group">
                    <h3>Настройки фона</h3>

                    <div class="radio-row">
                        <label class="radio"
                            ><input
                                type="radio"
                                value="blur"
                                v-model="backgroundConfig.type"
                            />
                            Размытие</label
                        >
                        <label class="radio"
                            ><input
                                type="radio"
                                value="color"
                                v-model="backgroundConfig.type"
                            />
                            Цвет</label
                        >
                        <label class="radio"
                            ><input
                                type="radio"
                                value="photo"
                                v-model="backgroundConfig.type"
                            />
                            Фото</label
                        >
                    </div>

                    <div v-if="backgroundConfig.type === 'blur'">
                        <label class="label"
                            >Сила размытия:
                            {{ backgroundConfig.blurAmount }}px</label
                        >
                        <input
                            type="range"
                            min="0"
                            max="40"
                            v-model.number="backgroundConfig.blurAmount"
                            class="range"
                        />
                    </div>

                    <div v-if="backgroundConfig.type === 'color'">
                        <label class="label">Цвет</label>
                        <div class="color-row">
                            <input
                                type="color"
                                v-model="backgroundConfig.color"
                                class="color-picker"
                            />
                            <span class="color-code">{{
                                backgroundConfig.color
                            }}</span>
                        </div>
                    </div>

                    <div v-if="backgroundConfig.type === 'photo'">
                        <label class="label">Фотографии</label>
                        <div class="carousel">
                            <button
                                v-for="(img, i) in images"
                                :key="img + i"
                                type="button"
                                class="thumb"
                                :class="{
                                    active: img === backgroundConfig.photo,
                                }"
                                @click="selectPhoto(img)"
                                title="Выбрать фон"
                            >
                                <img :src="img" alt="bg" />
                            </button>
                        </div>
                        <div class="hint" v-if="backgroundConfig.photo">
                            Выбрано: {{ backgroundConfig.photo }}
                        </div>
                    </div>

                    <label class="checkbox">
                        <input type="checkbox" v-model="backgroundEnabled" />
                        <span>Включить замену фона</span>
                    </label>
                </div>

                <div class="control-group">
                    <h3>Пресеты</h3>
                    <div class="presets">
                        <button
                            v-for="preset in presets"
                            :key="preset.id"
                            class="preset-btn"
                            @click="applyPreset(preset)"
                        >
                            {{ preset.icon }} {{ preset.name }}
                        </button>
                    </div>
                </div>

                <div class="action-buttons">
                    <button
                        @click="toggleCamera"
                        :class="[
                            'btn',
                            isRunning ? 'btn-danger' : 'btn-primary',
                        ]"
                    >
                        {{ isRunning ? "Остановить" : "Запустить" }}
                    </button>
                </div>
            </aside>

            <section class="video-panel">
                <VideoCanvas
                    ref="videoCanvas"
                    :user-info="{
                        name: humanize(employee.full_name),
                        position:
                            privacyLevel === 'high'
                                ? ''
                                : humanize(employee.position),
                        company: humanize(employee.company),
                    }"
                    :background-enabled="backgroundEnabled"
                    :background-config="backgroundConfig"
                    :show-stats="true"
                    @ready="onReady"
                />
            </section>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import VideoCanvas from "./VideoCanvas.vue";

const videoCanvas = ref(null);
const isRunning = ref(false);
const backgroundEnabled = ref(true);

// Employee info per JSON + privacy
const employee = ref({
    full_name: "ИвановСергейПетрович",
    position: "Ведущийинженерпокомпьютерномузрению",
    company: "ООО«РогаиКопыта»",
    department: "Департаменткомпьютерногозрения",
    office_location: "Новосибирск,технопарк«Идея»",
    contact: { email: "sergey.ivanov@t1dp.ru", telegram: "@sergey_vision" },
    branding: { slogan: "Инновациивкаждыйкадр" },
});
const privacyLevel = ref("medium");

// humanize helpers via computed
function humanize(s = "") {
    let x = s.replaceAll(",", ", ");
    x = x
        .replace(/([А-Яа-яЁё])([А-ЯЁ])/g, "$1 $2")
        .replace(/\s{2,}/g, " ")
        .trim();
    return x;
}
const fullNameC = computed({
    get: () => humanize(employee.value.full_name),
    set: (v) => (employee.value.full_name = humanize(v ?? "")),
});
const positionC = computed({
    get: () => humanize(employee.value.position),
    set: (v) => (employee.value.position = humanize(v ?? "")),
});
const companyC = computed({
    get: () => humanize(employee.value.company),
    set: (v) => (employee.value.company = humanize(v ?? "")),
});
const departmentC = computed({
    get: () => humanize(employee.value.department),
    set: (v) => (employee.value.department = humanize(v ?? "")),
});
const officeC = computed({
    get: () => humanize(employee.value.office_location),
    set: (v) => (employee.value.office_location = humanize(v ?? "")),
});
const sloganC = computed({
    get: () => humanize(employee.value.branding.slogan),
    set: (v) => (employee.value.branding.slogan = humanize(v ?? "")),
});

const selectPhoto = (img) => {
    // Всегда явно переключаемся в режим "photo"
    backgroundConfig.value.type = "photo";
    backgroundConfig.value.photo = img;
};

// Background config with new 'photo' type
const backgroundConfig = ref({
    type: "blur",
    blurAmount: 15,
    color: "#2e2e2e",
    photo: null,
});

const imageCandidates = [
    "images/office.png",
    "images/home.png",
    "images/bg1.jpg",
    "images/bg2.jpg",
    "images/bg3.jpg",
    "images/bg1.png",
    "images/bg2.png",
    "images/bg3.png",
];
const images = ref([]);
function probeImages() {
    images.value = [];
    imageCandidates.forEach((src) => {
        const img = new Image();
        img.onload = () => {
            if (!images.value.includes(src)) images.value.push(src);
            // НЕ перезаписываем, если уже выбрано
            if (
                backgroundConfig.value.type === "photo" &&
                !backgroundConfig.value.photo
            ) {
                backgroundConfig.value.photo = src;
            }
        };
        img.onerror = () => {};
        img.src = src;
    });
}
onMounted(probeImages);

// default first image when switching to photo
watch(
    () => backgroundConfig.value.type,
    (t) => {
        if (t === "photo" && !backgroundConfig.value.photo) {
            backgroundConfig.value.photo = images.value[0] || null;
        }
    },
);

const presets = [
    {
        id: "customer",
        name: "Встреча с заказчиком",
        icon: "🤝",
        config: { type: "photo", photo: "images/office.png" },
        privacy: "high",
    },
    {
        id: "friends",
        name: "Дружеская встреча",
        icon: "🍻",
        config: { type: "photo", photo: "images/home.png" },
        privacy: "low",
    },
    {
        id: "coworkers",
        name: "Встреча с коллегами",
        icon: "👥",
        config: { type: "photo", photo: "images/office.png" },
        privacy: "medium",
    },
];

const toggleCamera = async () => {
    if (!videoCanvas.value) return;
    if (isRunning.value) {
        videoCanvas.value.stop && (await videoCanvas.value.stop());
        isRunning.value = false;
    } else {
        try {
            await (videoCanvas.value.start && videoCanvas.value.start());
            isRunning.value = true;
        } catch (e) {
            console.error(e);
            alert("Не удалось запустить камеру: " + (e?.message || e));
        }
    }
};
const onReady = () => {};
const applyPreset = (p) => {
    Object.assign(backgroundConfig.value, p.config);
    backgroundEnabled.value = true;
    privacyLevel.value = p.privacy;
};
</script>

<style scoped>
.mono {
    color: #e6e7e9;
    background: #0f0f10;
}
.header {
    background: #141416;
    color: #e6e7e9;
    padding: 16px 20px;
    border-bottom: 1px solid #2a2b2e;
    display: flex;
    align-items: center;
}
.header h1 {
    font-size: 1.1rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0;
}
.header-year {
    margin-left: auto;
    color: #a7a9ad;
    font-size: 0.9rem;
}

.content {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 16px;
    padding: 16px;
    height: calc(100vh - 64px);
    overflow: hidden;
}
.controls-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    padding-right: 8px;
}

.control-group {
    background: #141416;
    border: 1px solid #2a2b2e;
    border-radius: 12px;
    padding: 10px;
}
.control-group h3 {
    font-size: 0.95rem;
    margin: 0 0 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #a7a9ad;
}

.label {
    font-size: 0.78rem;
    color: #a7a9ad;
    margin-top: 8px;
    margin-bottom: 4px;
    display: block;
}
.form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
}
.col-span-2 {
    grid-column: span 2;
}
.privacy-select {
    margin-bottom: 14px;
}

.input-field,
.select-field,
.range,
.color-picker {
    width: 100%;
    background: #1a1b1e;
    color: #e6e7e9;
    border: 1px solid #2a2b2e;
    border-radius: 10px;
    padding: 10px 12px;
}
.range {
    padding: 0;
}
.radio-row {
    display: flex;
    gap: 8px;
}
.radio {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: #1a1b1e;
    border: 1px solid #2a2b2e;
    border-radius: 999px;
}
.checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    color: #e6e7e9;
}

.presets {
    display: grid;
    gap: 8px;
}
.preset-btn {
    text-align: left;
    background: #1a1b1e;
    border: 1px solid #2a2b2e;
    color: #e6e7e9;
    border-radius: 10px;
    padding: 10px 12px;
}
.preset-btn:hover {
    border-color: #7a7d83;
}

.action-buttons {
    display: flex;
    gap: 10px;
}
.btn {
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid #2a2b2e;
    background: #1a1b1e;
    color: #e6e7e9;
}
.btn-primary {
    border-color: #7a7d83;
}
.btn-danger {
    border-color: #7a7d83;
}

.video-panel {
    background: #141416;
    border: 1px solid #2a2b2e;
    border-radius: 12px;
    padding: 8px;
    display: block;
    align-self: start;
    height: 100%;
    min-height: 540px;
    overflow: hidden;
}

.carousel {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
}
.thumb {
    background: #1a1b1e;
    border: 1px solid #2a2b2e;
    border-radius: 8px;
    padding: 0;
    overflow: hidden;
    aspect-ratio: 16/9;
}
.thumb.active {
    outline: 2px solid #7a7d83;
}
.thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.hint {
    font-size: 0.8rem;
    color: #a7a9ad;
    margin-top: 6px;
}
.color-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.color-code {
    font-size: 0.8rem;
    color: #a7a9ad;
}
.color-picker {
    appearance: auto;
    -webkit-appearance: auto;
    height: 36px;
    width: 48px;
    padding: 0;
    border: 1px solid #2a2b2e;
    border-radius: 6px;
}

@media (max-width: 1024px) {
    .content {
        grid-template-columns: 1fr;
    }
}
</style>
