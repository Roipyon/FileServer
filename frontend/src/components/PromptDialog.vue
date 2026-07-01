<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="dialogState.visible" class="prompt-backdrop" @click.self="handleCancel">
        <Transition name="confirm-scale" appear>
          <div v-if="dialogState.visible" class="prompt-card" @keydown.esc="handleCancel">
            <h3 class="prompt-title">{{ dialogState.title }}</h3>
            <p v-if="dialogState.message" class="prompt-message">{{ dialogState.message }}</p>
            <input
              ref="inputRef"
              class="prompt-input"
              :value="inputValue"
              @input="inputValue = $event.target.value"
              :placeholder="dialogState.placeholder"
              @keydown.enter="submit"
            />
            <div class="prompt-actions">
              <button class="prompt-btn prompt-btn-cancel" @click="handleCancel">
                {{ dialogState.cancelText }}
              </button>
              <button class="prompt-btn prompt-btn-accent" @click="submit">
                {{ dialogState.confirmText }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { usePromptDialog } from '../composables/usePromptDialog.js'

const { dialogState, handleConfirm, handleCancel } = usePromptDialog()
const inputRef = ref(null)
const inputValue = ref('')

watch(() => dialogState.value.visible, async (visible) => {
  if (visible) {
    inputValue.value = dialogState.value.defaultValue
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})

function submit() {
  handleConfirm(inputValue.value)
}
</script>

<style scoped>
.prompt-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(4px);
}

.prompt-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: 32px;
  max-width: 420px;
  width: 90%;
}

.prompt-title {
  font-family: 'Playfair Display', serif;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.prompt-message {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 16px;
}

.prompt-input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'DM Sans', monospace;
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--duration-normal) var(--ease-out-expo);
  margin-bottom: 24px;
}

.prompt-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.prompt-btn {
  padding: 10px 24px;
  border-radius: var(--radius-md);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.prompt-btn-cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.prompt-btn-cancel:hover {
  color: var(--text-primary);
  background: var(--border-glow);
}

.prompt-btn-accent {
  background: var(--accent);
  color: var(--text-inverse);
}
.prompt-btn-accent:hover {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
  transform: translateY(-1px);
}

/* Transitions */
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

.confirm-scale-enter-active {
  transition: all 250ms var(--ease-spring);
}
.confirm-scale-leave-active {
  transition: all 200ms var(--ease-out-expo);
}
.confirm-scale-enter-from {
  opacity: 0;
  transform: scale(0.92);
}
.confirm-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

@media (max-width: 768px) {
  .prompt-card {
    padding: 24px;
  }
}
</style>
