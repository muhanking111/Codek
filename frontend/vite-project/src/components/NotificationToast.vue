<template>
  <div
    class="notification-container"
    data-codek-smoke="notification-toast-container"
    data-notification-state-source="workbenchStatusNotificationProgressService"
  >
    <TransitionGroup name="notif-slide">
      <div
        v-for="item in notifications"
        :key="item.id"
        class="notification-toast"
        :class="item.type"
        role="alert"
        aria-live="assertive"
        data-codek-smoke="notification-toast"
        :data-notification-owner="'NotificationToast'"
        :data-notification-service-source="'workbenchStatusNotificationProgressService'"
        :data-notification-id="item.id"
        :data-notification-source="item.source"
        :data-notification-severity="item.severity"
        :data-notification-dismiss-command="item.dismissCommandId"
        :data-notification-focus-target="item.focusTarget"
        :data-notification-progress-owner="
          hasProgress(item) ? 'workbenchStatusNotificationProgressService.withProgress' : ''
        "
        :data-notification-no-second-state="'true'"
        @mouseenter="handleMouseEnter(item.id)"
        @mouseleave="handleMouseLeave(item.id)"
      >
        <span class="notif-icon">{{ iconMap[item.type] }}</span>
        <div class="notif-body">
          <span class="notif-message">{{ item.message }}</span>
          <div
            v-if="hasProgress(item)"
            class="notif-progress"
            role="progressbar"
            :aria-valuemin="0"
            :aria-valuemax="progressMax(item)"
            :aria-valuenow="item.progress.infinite ? undefined : progressValue(item)"
            :data-notification-progress-infinite="String(item.progress.infinite)"
            :data-notification-progress-total="item.progress.total"
            :data-notification-progress-worked="item.progress.worked"
            :data-notification-progress-done="String(item.progress.done)"
          >
            <span
              class="notif-progress-bar"
              :class="{ infinite: item.progress.infinite }"
              :style="{ width: progressWidth(item) }"
            ></span>
          </div>
          <div
            v-if="item.actions.primary.length || item.actions.secondary.length"
            class="notif-actions"
            :data-notification-action-ids="notificationActionIds(item)"
          >
            <button
              v-for="action in item.actions.primary"
              :key="`primary:${action.id}`"
              class="notif-action notif-action-primary"
              type="button"
              :data-notification-action-id="action.id"
              :data-notification-action-secondary="String(action.isSecondary)"
              :data-notification-action-owner="'workbenchStatusNotificationProgressService.invokeNotificationAction'"
              :data-notification-action-notification-id="item.id"
              :data-notification-action-command="action.command || ''"
              :data-notification-action-keep-open="String(action.keepOpen)"
              @click="runAction(item.id, action.id)"
            >
              {{ action.label }}
            </button>
            <button
              v-for="action in item.actions.secondary"
              :key="`secondary:${action.id}`"
              class="notif-action notif-action-secondary"
              type="button"
              :data-notification-action-id="action.id"
              :data-notification-action-secondary="String(action.isSecondary)"
              :data-notification-action-owner="'workbenchStatusNotificationProgressService.invokeNotificationAction'"
              :data-notification-action-notification-id="item.id"
              :data-notification-action-command="action.command || ''"
              :data-notification-action-keep-open="String(action.keepOpen)"
              @click="runAction(item.id, action.id)"
            >
              {{ action.label }}
            </button>
          </div>
        </div>
        <button
          class="notif-close"
          type="button"
          aria-label="关闭通知"
          data-codek-smoke="notification-dismiss"
          :data-notification-dismiss-command="item.dismissCommandId"
          @click="dismiss(item.id)"
        >
          &times;
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"
import {
  subscribe,
  dismissNotification,
  invokeNotificationAction,
  type NotificationItem,
  type NotificationType,
} from "../utils/notifications"

const notifications = ref<NotificationItem[]>([])

const iconMap: Record<NotificationType, string> = {
  info: "\u2139",
  success: "\u2713",
  warning: "\u26A0",
  error: "\u2715",
}

const pauseTimers = new Map<string, ReturnType<typeof setTimeout>>()

const unsubscribe = subscribe((items: NotificationItem[]) => {
  notifications.value = items
})

function dismiss(id: string): void {
  const timer = pauseTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    pauseTimers.delete(id)
  }
  dismissNotification(id)
}

function notificationActionIds(item: NotificationItem): string {
  return [...item.actions.primary, ...item.actions.secondary].map((action) => action.id).join(",")
}

function hasProgress(item: NotificationItem): boolean {
  return (
    item.progress.infinite ||
    item.progress.total > 0 ||
    item.progress.worked > 0 ||
    item.progress.done
  )
}

function progressMax(item: NotificationItem): number {
  return item.progress.total > 0 ? item.progress.total : 100
}

function progressValue(item: NotificationItem): number {
  return Math.min(progressMax(item), Math.max(0, item.progress.worked))
}

function progressWidth(item: NotificationItem): string {
  if (item.progress.infinite) return "100%"
  return `${Math.round((progressValue(item) / progressMax(item)) * 100)}%`
}

async function runAction(id: string, actionId: string): Promise<void> {
  await invokeNotificationAction(id, actionId)
}

function handleMouseEnter(id: string): void {
  const timer = pauseTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    pauseTimers.delete(id)
  }
}

function handleMouseLeave(id: string): void {
  const item = notifications.value.find((n) => n.id === id)
  if (!item) return

  const elapsed = Date.now() - item.createdAt
  const remaining = Math.max(500, item.duration - elapsed)

  const timer = setTimeout(() => dismiss(id), remaining)
  pauseTimers.set(id, timer)
}

onBeforeUnmount(() => {
  unsubscribe()
  pauseTimers.forEach((timer) => clearTimeout(timer))
  pauseTimers.clear()
})
</script>

<style scoped>
.notification-container {
  --codek-caption-safe-right: 154px;
  position: fixed;
  top: 52px;
  right: calc(12px + var(--codek-caption-safe-right));
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  width: min(380px, calc(100vw - 32px - var(--codek-caption-safe-right)));
  max-width: 380px;
}

.notification-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  min-width: 260px;
  width: 100%;
  box-sizing: border-box;
}

@media (max-width: 720px) {
  .notification-container {
    top: 58px;
    right: 12px;
    left: 12px;
    width: auto;
    max-width: none;
  }

  .notification-toast {
    min-width: 0;
  }
}

.notification-toast.info {
  border-left: 3px solid #60a5fa;
}

.notification-toast.success {
  border-left: 3px solid var(--green);
}

.notification-toast.warning {
  border-left: 3px solid var(--orange);
}

.notification-toast.error {
  border-left: 3px solid var(--red);
}

.notif-icon {
  font-size: 15px;
  font-weight: 700;
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.notification-toast.info .notif-icon {
  color: #60a5fa;
}

.notification-toast.success .notif-icon {
  color: var(--green);
}

.notification-toast.warning .notif-icon {
  color: var(--orange);
}

.notification-toast.error .notif-icon {
  color: var(--red);
}

.notif-message {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.45;
  word-break: break-word;
}

.notif-body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.notif-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.notif-progress {
  position: relative;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
}

.notif-progress-bar {
  display: block;
  height: 100%;
  min-width: 3px;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.18s ease;
}

.notif-progress-bar.infinite {
  width: 45% !important;
  animation: notif-progress-indeterminate 1.1s ease-in-out infinite;
}

.notif-action {
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
  padding: 4px 8px;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.notif-action-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-foreground, #fff);
}

.notif-action-secondary {
  background: transparent;
  color: var(--text-secondary);
}

.notif-action:hover {
  border-color: var(--text-muted);
}

.notif-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}

.notif-close:hover {
  color: var(--text-primary);
}

.notif-slide-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.notif-slide-leave-active {
  transition: all 0.2s ease-in;
}

.notif-slide-enter-from {
  opacity: 0;
  transform: translateX(40px);
}

.notif-slide-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

.notif-slide-move {
  transition: transform 0.25s ease;
}

@keyframes notif-progress-indeterminate {
  0% {
    transform: translateX(-120%);
  }

  100% {
    transform: translateX(260%);
  }
}
</style>
