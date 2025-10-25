<template>
    <div class="user-info" :class="{ presentation: presentationMode }">
        <div class="name">{{ name }}</div>
        <div class="position">{{ position }}</div>
        <div class="company">{{ company }}</div>
    </div>
</template>

<script setup>
defineProps({
    name: String,
    position: String,
    company: String,
    presentationMode: {
        type: Boolean,
        default: false,
    },
});
</script>

<style scoped>
.user-info {
    position: absolute;
    bottom: 30px;
    left: 30px;
    z-index: 10;
    /* УБИРАЕМ ФОН! Используем только текст с контрастом */
}

.user-info.presentation {
    bottom: 50px;
    left: 50px;
}

.name,
.position,
.company {
    /* Контрастный текст через тени и обводку */
    color: white;
    font-weight: 700;
    text-shadow:
        -2px -2px 4px #000,
        2px -2px 4px #000,
        -2px 2px 4px #000,
        2px 2px 4px #000,
        0 0 15px rgba(0, 0, 0, 0.9),
        0 0 30px rgba(0, 0, 0, 0.7);
    letter-spacing: 0.5px;
}

.name {
    font-size: 2rem;
    margin-bottom: 8px;
    font-weight: 800;
    /* Дополнительный эффект для имени */
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.8));
}

.position {
    font-size: 1.3rem;
    color: #ffd700;
    margin-bottom: 5px;
    font-weight: 700;
    text-shadow:
        -2px -2px 3px #000,
        2px -2px 3px #000,
        -2px 2px 3px #000,
        2px 2px 3px #000,
        0 0 10px rgba(0, 0, 0, 0.9);
}

.company {
    font-size: 1rem;
    color: #e0e0e0;
    font-weight: 600;
    text-shadow:
        -1px -1px 3px #000,
        1px -1px 3px #000,
        -1px 1px 3px #000,
        1px 1px 3px #000,
        0 0 8px rgba(0, 0, 0, 0.9);
}

/* Презентационный режим - крупнее */
.presentation .name {
    font-size: 2.8rem;
}

.presentation .position {
    font-size: 1.6rem;
}

.presentation .company {
    font-size: 1.2rem;
}

/* Анимация появления */
.user-info {
    animation: slideIn 0.5s ease-out;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-30px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

/* Адаптивность */
@media (max-width: 768px) {
    .user-info {
        bottom: 20px;
        left: 20px;
    }

    .name {
        font-size: 1.5rem;
    }

    .position {
        font-size: 1rem;
    }

    .company {
        font-size: 0.9rem;
    }
}
</style>
