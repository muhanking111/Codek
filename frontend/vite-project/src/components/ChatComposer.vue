<template>
  <div class="chat-composer">
    <div class="composer-input">
      <slot name="input" />
    </div>
    <div class="composer-bottom composer-tools">
      <div class="composer-left composer-left-tools">
        <slot name="left" />
      </div>
      <div class="composer-right composer-send-tools">
        <slot name="right" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-composer {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 74%, #0d1117 26%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.chat-composer:focus-within {
  border-color: color-mix(in srgb, var(--accent) 56%, var(--border-subtle));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025), 0 0 0 1px rgba(45, 212, 191, 0.1);
}

.composer-input {
  min-width: 0;
}

.composer-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
  min-width: 0;
  min-height: 28px;
}

.composer-left,
.composer-right {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 28px;
}

.composer-left {
  flex: 1 1 auto;
  overflow: visible;
}

.composer-right {
  flex: 0 0 auto;
  margin-left: auto;
  align-self: center;
}

.composer-send-tools {
  justify-content: flex-end;
  white-space: nowrap;
}

@container (max-width: 390px) {
  .composer-bottom {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 8px;
  }

  .composer-left {
    width: 100%;
  }

  .composer-right {
    width: 100%;
    margin-left: auto;
    justify-content: flex-end;
  }
}
</style>
